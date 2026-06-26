'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Loader2,
  Crown,
  AlertCircle,
  Plus,
  GripVertical,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Users,
  ArrowUpToLine,
  Bot,
  ShieldAlert,
  Clock,
  Network,
} from 'lucide-react'
import { roleColor, snowflakeToDate, type DiscordRole } from '@/lib/discord'
import { permissionKeysFromBits, dangerousKeysIn } from '@/lib/discord-permissions'
import { PageHeader } from '@/components/ui/page-header'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { CategorySection } from '@/components/ui/category-section'
import { RoleEditPanel } from './roles/RoleEditPanel'
import { TemporaryRolesContent } from './roles/TemporaryRolesContent'
import { RoleHierarchyContent } from './roles/RoleHierarchyContent'
import type { PermissionPreset } from '@/app/api/guilds/[guildId]/permission-presets/route'

type Member = {
  user: { id: string }
  roles: string[]
}

type Toast = { kind: 'ok' | 'err'; text: string }

// The roles grid template lives in globals.css as `.role-grid` (shared between
// the header and each row so columns stay aligned) — that lets a media query
// restack it into labelled cards on phones, which an inline style couldn't.

// Substring of the moderation-auth transient-failure message. When the API
// returns this, the dashboard keeps the loading spinner up and silently
// retries instead of surfacing a scary banner the user can't act on.
const TRANSIENT_ERROR_HINT = "Couldn't verify your Discord access"
// Roughly 30s of retrying before giving up and showing the error.
const MAX_TRANSIENT_RETRIES = 15

type Props = { guildId: string }

export function RolesContent({ guildId }: Props) {
  const [roles, setRoles] = useState<DiscordRole[]>([])
  const [memberCountByRole, setMemberCountByRole] = useState<Map<string, number>>(new Map())
  // Unique members holding at least one role — the Hierarchy tab needs this and
  // it can't be derived from the per-role counts (members can hold many roles).
  const [membersWithRoles, setMembersWithRoles] = useState(0)
  const [presets, setPresets] = useState<PermissionPreset[]>([])
  const [loading, setLoading] = useState(true)
  const [reordering, setReordering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  const [editingRole, setEditingRole] = useState<DiscordRole | null>(null)
  const [creating, setCreating] = useState(false)
  // Sub-view: classic role management, the Hierarchy overview, or Temporary Roles.
  const [tab, setTab] = useState<'roles' | 'hierarchy' | 'temporary'>('roles')

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const fetchAll = useCallback(async (attempt = 0): Promise<void> => {
    const [rolesRes, membersRes, presetsRes] = await Promise.all([
      fetch(`/api/discord/guild/${guildId}/roles`, { cache: 'no-store' }),
      fetch(`/api/discord/guild/${guildId}/members?limit=1000`, { cache: 'no-store' }),
      fetch(`/api/guilds/${guildId}/permission-presets`, { cache: 'no-store' }),
    ])

    if (!rolesRes.ok) {
      const data = (await rolesRes.json().catch(() => ({}))) as { error?: string }
      // Transient Discord blip — keep the spinner up and retry silently. All
      // three endpoints share the same auth path, so checking roles is enough.
      if (data.error?.includes(TRANSIENT_ERROR_HINT) && attempt < MAX_TRANSIENT_RETRIES) {
        // Linear backoff: 600ms → 2000ms cap. Stays responsive without
        // hammering Discord while it's already throttling us.
        const delay = Math.min(2000, 600 + attempt * 200)
        retryTimerRef.current = setTimeout(() => fetchAll(attempt + 1), delay)
        return
      }
      setError(data.error ?? 'Could not load roles.')
      setLoading(false)
      return
    }

    const data = (await rolesRes.json()) as DiscordRole[]
    setRoles(data)

    if (membersRes.ok) {
      const members = (await membersRes.json()) as Member[]
      const counts = new Map<string, number>()
      let withRoles = 0
      for (const m of members) {
        if (m.roles.length > 0) withRoles++
        for (const rid of m.roles) counts.set(rid, (counts.get(rid) ?? 0) + 1)
      }
      setMemberCountByRole(counts)
      setMembersWithRoles(withRoles)
    }

    if (presetsRes.ok) {
      setPresets((await presetsRes.json()) as PermissionPreset[])
    }

    setError(null)
    setLoading(false)
  }, [guildId])

  useEffect(() => {
    fetchAll()
    return () => {
      // Cancel any pending retry on unmount so we don't setState after teardown.
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [fetchAll])

  // Deep-link handling, read once on mount. The command palette's "Create role"
  // quick action lands here with ?new=1 (open the creator); notification links
  // land with ?tab=temporary (open the Temporary Roles tab). Strip whichever
  // param fired so a refresh doesn't replay it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    let changed = false
    const tabParam = params.get('tab')
    if (tabParam === 'temporary' || tabParam === 'hierarchy') {
      setTab(tabParam)
      params.delete('tab')
      changed = true
    }
    if (params.get('new') === '1') {
      openCreate()
      params.delete('new')
      changed = true
    }
    if (changed) {
      const qs = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Roles excluding @everyone, sorted top-down by position. The list state is
  // the source of truth for DnD order; we PATCH Discord with the new
  // positions on drop.
  const sortedRoles = useMemo(
    () => roles.filter((r) => r.name !== '@everyone').sort((a, b) => b.position - a.position),
    [roles],
  )

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return

    const fromIndex = sortedRoles.findIndex((r) => r.id === active.id)
    const toIndex = sortedRoles.findIndex((r) => r.id === over.id)
    if (fromIndex === -1 || toIndex === -1) return

    const movedRole = sortedRoles[fromIndex]
    if (movedRole.managed) {
      setToast({ kind: 'err', text: 'Managed roles cannot be moved.' })
      return
    }

    // Reorder locally then rebuild authoritative positions: the role at array
    // index 0 (top of the list) gets the highest position; index n-1 gets the
    // lowest. We send every affected role's new position to Discord.
    const reordered = arrayMove(sortedRoles, fromIndex, toIndex)
    const originalPositions = sortedRoles
      .map((r) => r.position)
      .sort((a, b) => b - a)
    const updates: { id: string; position: number }[] = []
    reordered.forEach((r, i) => {
      const newPos = originalPositions[i]
      if (r.position !== newPos) updates.push({ id: r.id, position: newPos })
    })

    if (updates.length === 0) return

    // Optimistic update
    setRoles((prev) => {
      const m = new Map(updates.map((u) => [u.id, u.position]))
      return prev.map((r) => (m.has(r.id) ? { ...r, position: m.get(r.id)! } : r))
    })

    setReordering(true)
    setError(null)
    const res = await fetch(`/api/discord/guild/${guildId}/roles`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions: updates }),
    })
    setReordering(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Failed to reorder roles.')
      fetchAll()
      return
    }
    setToast({ kind: 'ok', text: 'Role order saved.' })
  }

  function openEditor(role: DiscordRole) {
    setCreating(false)
    setEditingRole(role)
  }

  function openCreate() {
    setEditingRole(null)
    setCreating(true)
  }

  function closeEditor() {
    setEditingRole(null)
    setCreating(false)
  }

  function handleSaved(saved: DiscordRole, isNew: boolean) {
    setRoles((prev) => {
      if (isNew) return [...prev, saved]
      return prev.map((r) => (r.id === saved.id ? saved : r))
    })
    setToast({ kind: 'ok', text: isNew ? 'Role created.' : 'Role updated.' })
    closeEditor()
  }

  function handleDeleted(roleId: string) {
    setRoles((prev) => prev.filter((r) => r.id !== roleId))
    setToast({ kind: 'ok', text: 'Role deleted.' })
    closeEditor()
  }

  function handleDuplicated(role: DiscordRole) {
    setRoles((prev) => [...prev, role])
    setToast({ kind: 'ok', text: `Duplicated as @${role.name}.` })
    // Keep the editor open on the new role so the user can rename it.
    setEditingRole(role)
    setCreating(false)
  }

  if (loading) {
    return (
      <div className="page-content">
        <PageHeader title="Roles" helpId="roles" description="View and manage the roles configured on your server." />
        <TableSkeleton rows={8} columns={4} className="mt-6" />
      </div>
    )
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Roles"
        helpId="roles"
        description="View and manage the roles configured on your server."
      />

      {error && (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
        >
          <AlertCircle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {toast && (
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: toast.kind === 'ok' ? 'rgba(74,222,128,0.35)' : 'rgba(239,68,68,0.35)',
            background: toast.kind === 'ok' ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)',
            color: toast.kind === 'ok' ? '#4ade80' : '#f87171',
          }}
        >
          {toast.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {toast.text}
        </div>
      )}

      {/* Page-level tabs: classic role management vs Temporary Roles. */}
      <div className="mb-6 inline-flex rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        {([
          { id: 'roles' as const, label: 'Roles', icon: <Users size={15} /> },
          { id: 'temporary' as const, label: 'Temporary Roles', icon: <Clock size={15} /> },
          { id: 'hierarchy' as const, label: 'Hierarchy', icon: <Network size={15} /> },
        ]).map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors"
              style={active ? { background: 'var(--p-soft)', color: 'var(--text)' } : { color: 'var(--text-2)' }}
            >
              <span style={active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{t.icon}</span>
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'temporary' && <TemporaryRolesContent guildId={guildId} roles={roles} />}

      {tab === 'hierarchy' && (
        <RoleHierarchyContent
          roles={roles}
          memberCountByRole={memberCountByRole}
          membersWithRoles={membersWithRoles}
          onSelectRole={openEditor}
          onRefresh={fetchAll}
        />
      )}

      {tab === 'roles' && (
      <>
      <div className="space-y-8">
        <CategorySection
          icon={<TrendingUp size={14} />}
          title="At a glance"
          description="Snapshot of role usage and configuration on this server."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={<Users size={16} />} label="Total roles" value={sortedRoles.length} accent="var(--p-1)" />
            <Stat icon={<ArrowUpToLine size={16} />} label="Hoisted" value={sortedRoles.filter((r) => r.hoist).length} accent="#3b82f6" />
            <Stat icon={<Bot size={16} />} label="Managed" value={sortedRoles.filter((r) => r.managed).length} accent="#a855f7" />
            <Stat
              icon={<ShieldAlert size={16} />}
              label="With sensitive perms"
              value={sortedRoles.filter((r) => dangerousKeysIn(permissionKeysFromBits(r.permissions)).length > 0).length}
              accent="#f59e0b"
            />
          </div>
        </CategorySection>

        <CategorySection
          icon={<Crown size={14} />}
          title="Hierarchy"
          description="Drag rows to reorder roles top-down. Click any row to edit name, color, and permissions."
        >
          <div className="flex flex-wrap items-center gap-3">
            {reordering && (
              <span className="inline-flex items-center gap-1.5 text-xs text-subtle">
                <Loader2 size={11} className="animate-spin" /> Saving order…
              </span>
            )}
            <button
              type="button"
              onClick={openCreate}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition"
              style={{ background: 'var(--p-1)', color: '#fff' }}
            >
              <Plus size={14} />
              Create role
            </button>
          </div>

          {sortedRoles.length === 0 ? (
            <EmptyState
              icon={<Crown size={36} />}
              title="No custom roles"
              description="This server only has the @everyone role. Use Create role to add one."
            />
          ) : (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
              <div
                className="role-grid role-grid-header border-b px-4 py-2 text-xs font-semibold uppercase tracking-wider text-subtle"
                style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
              >
                <span />
                <span>Role</span>
                <span className="text-center">Members</span>
                <span>Created</span>
                <span>Properties</span>
                <span className="text-center">Position</span>
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={sortedRoles.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                  <div>
                    {sortedRoles.map((role) => (
                      <SortableRoleRow
                        key={role.id}
                        role={role}
                        memberCount={memberCountByRole.get(role.id) ?? 0}
                        onClick={() => openEditor(role)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}
        </CategorySection>
      </div>
      </>
      )}

      {/* Editor lives outside the tab switch so clicking a role from either the
          Roles list or the Hierarchy view opens the same edit/create flow. */}
      {(editingRole || creating) && (
        <RoleEditPanel
          guildId={guildId}
          role={editingRole}
          isCreating={creating}
          presets={presets}
          onClose={closeEditor}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onDuplicated={handleDuplicated}
          onPresetsChanged={() => {
            // Re-fetch presets when the user creates a new one from the panel.
            fetch(`/api/guilds/${guildId}/permission-presets`, { cache: 'no-store' })
              .then((r) => (r.ok ? r.json() : []))
              .then((d: PermissionPreset[]) => setPresets(d))
          }}
        />
      )}
    </div>
  )
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border p-4"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-semibold leading-none text-foreground">{value.toLocaleString()}</p>
        <p className="mt-1 text-xs text-subtle">{label}</p>
      </div>
    </div>
  )
}

function SortableRoleRow({
  role,
  memberCount,
  onClick,
}: {
  role: DiscordRole
  memberCount: number
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: role.id,
    disabled: role.managed,
  })

  const color = roleColor(role.color)
  const dangerCount = useMemo(() => {
    const keys = permissionKeysFromBits(role.permissions)
    return dangerousKeysIn(keys).length
  }, [role.permissions])
  const createdLabel = useMemo(() => {
    const d = snowflakeToDate(role.id)
    return d ? d.toLocaleString('en-US') : null
  }, [role.id])

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        background: isDragging
          ? 'var(--bg-2)'
          : 'color-mix(in srgb, var(--panel) 50%, transparent)',
        borderColor: 'var(--line-strong)',
      }}
      className="group role-grid role-grid-row border-b px-4 py-2 text-sm cursor-pointer transition-colors hover:bg-[var(--bg-2)]"
      onClick={onClick}
    >
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        disabled={role.managed}
        title={role.managed ? 'Managed roles cannot be moved' : 'Drag to reorder'}
        className="role-drag flex h-5 w-5 cursor-grab items-center justify-center text-muted-foreground transition active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
        aria-label={`Drag handle for ${role.name}`}
      >
        <GripVertical size={14} />
      </button>

      <div className="role-name flex min-w-0 items-center gap-3">
        <span
          className="h-3.5 w-3.5 rounded-full border shrink-0"
          style={{ backgroundColor: color, borderColor: 'var(--line-strong)' }}
        />
        <span
          className="font-medium truncate"
          style={{ color: role.color !== 0 ? color : 'var(--text)' }}
        >
          @{role.name}
        </span>
        {dangerCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
            style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}
            title={`${dangerCount} sensitive permission${dangerCount === 1 ? '' : 's'} enabled`}
          >
            <AlertTriangle size={9} />
            {dangerCount}
          </span>
        )}
      </div>

      <span className="text-center text-muted-foreground font-mono text-xs" data-label="Members">
        {memberCount.toLocaleString()}
      </span>

      <span className="text-subtle font-mono text-xs truncate" title={createdLabel ?? undefined} data-label="Created">
        {createdLabel ?? '—'}
      </span>

      <div className="flex flex-wrap gap-1" data-label="Properties">
        {role.hoist && (
          <span className="rounded px-1.5 py-0.5 text-xs text-muted-foreground" style={{ background: 'var(--bg-2)' }}>
            Hoisted
          </span>
        )}
        {role.mentionable && (
          <span className="rounded px-1.5 py-0.5 text-xs text-muted-foreground" style={{ background: 'var(--bg-2)' }}>
            Mentionable
          </span>
        )}
        {role.managed && (
          <span className="rounded px-1.5 py-0.5 text-xs" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
            Managed
          </span>
        )}
      </div>

      <span className="text-center text-subtle font-mono text-xs" data-label="Position">#{role.position}</span>
    </div>
  )
}
