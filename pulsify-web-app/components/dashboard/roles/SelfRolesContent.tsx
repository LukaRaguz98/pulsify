'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Loader2,
  Plus,
  Search,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  MousePointerClick,
  ListChecks,
  Users,
  Hash,
  Layers,
  ExternalLink,
  Pencil,
  Copy,
  Archive,
  Play,
  Pause,
  Trash2,
  BarChart3,
  UserPlus,
} from 'lucide-react'
import type { DiscordRole } from '@/lib/discord'
import { roleColor } from '@/lib/discord'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { getAutoRole, saveAutoRole, type AutoRoleConfig } from '@/app/dashboard/[guildId]/(management)/roles/actions'
import { SelfRoleMenuBuilder } from './SelfRoleMenuBuilder'
import {
  normaliseMenu,
  computeSelfRoleStats,
  CATEGORY_META,
  MENU_STATUS_META,
  MENU_TYPE_META,
  timeAgo,
  type SelfRoleMenu,
  type AssignmentRow,
  type MenuStatus,
} from '@/lib/self-roles'

type ChannelOption = { id: string; name: string }
type Toast = { kind: 'ok' | 'err'; text: string }
type StatusFilter = 'all' | MenuStatus

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'draft', label: 'Draft' },
  { key: 'disabled', label: 'Disabled' },
  { key: 'archived', label: 'Archived' },
]

type Props = {
  guildId: string
  roles: DiscordRole[]
}

export function SelfRolesContent({ guildId, roles }: Props) {
  const [menus, setMenus] = useState<SelfRoleMenu[]>([])
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [channels, setChannels] = useState<ChannelOption[]>([])
  // The guild's configured embed accent (Server Settings → Embed Appearance) —
  // the builder preview uses it so it matches what the bot posts.
  const [embedColor, setEmbedColor] = useState('#8b5cf6')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [builder, setBuilder] = useState<{ menu: SelfRoleMenu | null } | null>(null)
  const [confirm, setConfirm] = useState<{ menu: SelfRoleMenu; busy?: boolean; error?: string | null } | null>(null)

  const channelName = useCallback((id: string) => channels.find((c) => c.id === id)?.name ?? null, [channels])

  const fetchAll = useCallback(async () => {
    const [menusRes, channelsRes] = await Promise.all([
      fetch(`/api/discord/guild/${guildId}/self-roles`, { cache: 'no-store' }),
      fetch(`/api/discord/guild/${guildId}/channels`, { cache: 'no-store' }),
    ])
    if (!menusRes.ok) {
      const data = (await menusRes.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Could not load role menus.')
      setLoading(false)
      return
    }
    const data = (await menusRes.json()) as { menus: Record<string, unknown>[]; assignments: AssignmentRow[]; embedColor?: string }
    setMenus(data.menus.map(normaliseMenu))
    setAssignments(data.assignments ?? [])
    if (data.embedColor) setEmbedColor(data.embedColor)
    if (channelsRes.ok) {
      const chans = (await channelsRes.json()) as { id: string; name: string; type: number }[]
      // Text (0) + announcement (5) channels can hold a menu message.
      setChannels(chans.filter((c) => c.type === 0 || c.type === 5).map((c) => ({ id: c.id, name: c.name })))
    }
    setError(null)
    setLoading(false)
  }, [guildId])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const stats = useMemo(() => computeSelfRoleStats(menus, assignments), [menus, assignments])

  // Added-assignment count per menu, for the card metric.
  const addsByMenu = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of assignments) {
      if (a.action !== 'added' || !a.menu_id) continue
      m.set(a.menu_id, (m.get(a.menu_id) ?? 0) + 1)
    }
    return m
  }, [assignments])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return menus
      .filter((m) => (statusFilter === 'all' ? true : m.status === statusFilter))
      .filter((m) => (q ? m.title.toLowerCase().includes(q) || m.roles.some((r) => r.label.toLowerCase().includes(q)) : true))
  }, [menus, query, statusFilter])

  function onSaved(saved: SelfRoleMenu, isNew: boolean) {
    const menu = normaliseMenu(saved as unknown as Record<string, unknown>)
    setMenus((prev) => (isNew ? [menu, ...prev] : prev.map((m) => (m.id === menu.id ? menu : m))))
    setToast({ kind: 'ok', text: isNew ? 'Role menu created.' : 'Role menu saved.' })
    setBuilder(null)
  }

  async function setStatus(menu: SelfRoleMenu, status: MenuStatus) {
    const res = await fetch(`/api/discord/guild/${guildId}/self-roles/${menu.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast({ kind: 'err', text: data.error ?? 'Could not update the menu.' })
      return
    }
    const saved = normaliseMenu((await res.json()) as Record<string, unknown>)
    setMenus((prev) => prev.map((m) => (m.id === saved.id ? saved : m)))
    setToast({ kind: 'ok', text: `Menu ${MENU_STATUS_META[status].label.toLowerCase()}.` })
  }

  async function duplicate(menu: SelfRoleMenu) {
    const res = await fetch(`/api/discord/guild/${guildId}/self-roles/${menu.id}/duplicate`, { method: 'POST' })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast({ kind: 'err', text: data.error ?? 'Could not duplicate the menu.' })
      return
    }
    const copy = normaliseMenu((await res.json()) as Record<string, unknown>)
    setMenus((prev) => [copy, ...prev])
    setToast({ kind: 'ok', text: 'Menu duplicated as a draft.' })
  }

  async function doDelete() {
    if (!confirm) return
    setConfirm({ ...confirm, busy: true, error: null })
    const res = await fetch(`/api/discord/guild/${guildId}/self-roles/${confirm.menu.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setConfirm({ ...confirm, busy: false, error: data.error ?? 'Could not delete the menu.' })
      return
    }
    setMenus((prev) => prev.filter((m) => m.id !== confirm.menu.id))
    setToast({ kind: 'ok', text: 'Role menu deleted.' })
    setConfirm(null)
  }

  if (loading) return <TableSkeleton rows={6} columns={4} />

  return (
    <div className="space-y-8">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
          <AlertCircle size={14} className="shrink-0" /> {error}
        </div>
      )}
      {toast && (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: toast.kind === 'ok' ? 'rgba(74,222,128,0.35)' : 'rgba(239,68,68,0.35)', background: toast.kind === 'ok' ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)', color: toast.kind === 'ok' ? '#4ade80' : '#f87171' }}>
          {toast.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} {toast.text}
        </div>
      )}

      {/* At a glance */}
      <CategorySection icon={<TrendingUp size={14} />} title="At a glance" description="Self-assign role menus and how members are using them." helpId="self-roles">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={<Layers size={16} />} label="Active menus" value={stats.activeMenus} accent="#22c55e" />
          <Stat icon={<Hash size={16} />} label="Roles offered" value={stats.totalRoles} accent="var(--p-1)" />
          <Stat icon={<BarChart3 size={16} />} label="Self-assignments" value={stats.totalAssignments} accent="#3b82f6" />
          <Stat icon={<Users size={16} />} label="Members" value={stats.uniqueMembers} accent="#a855f7" />
        </div>
      </CategorySection>

      {/* Auto-Role — automatically hand every new member a role on join. Moved
          here from Automations; it's the natural neighbour of the self-assign
          menus (both are "how members get roles"). */}
      <CategorySection
        icon={<UserPlus size={14} />}
        title="Auto-role on join"
        description="Automatically give every new member a role the moment they join — no action needed on their part."
      >
        <AutoRoleCard guildId={guildId} roles={roles} onToast={setToast} />
      </CategorySection>

      {/* Analytics */}
      {stats.totalAssignments > 0 && (
        <CategorySection icon={<BarChart3 size={14} />} title="Usage analytics" description="Which roles members pick most, and activity over the last 14 days.">
          <div className="grid gap-4 lg:grid-cols-2">
            <RoleBars title="Most selected" rows={stats.mostSelected} />
            <RoleBars title="Least selected" rows={stats.leastSelected} muted />
          </div>
          <TrendChart series={stats.series} />
        </CategorySection>
      )}

      {/* Menus */}
      <CategorySection icon={<Layers size={14} />} title="Role menus" description="Create, edit, duplicate, disable and archive your self-assign menus.">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full sm:w-[360px]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search menus…" className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-lg border p-1" style={{ borderColor: 'var(--line-strong)' }}>
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setStatusFilter(f.key)}
                  className="rounded-md px-2.5 py-1 text-xs font-medium transition"
                  style={{
                    background: statusFilter === f.key ? 'var(--p-soft)' : 'transparent',
                    color: statusFilter === f.key ? 'var(--p-1)' : 'var(--text-3)',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setBuilder({ menu: null })} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition" style={{ background: 'var(--p-1)' }}>
              <Plus size={14} /> New menu
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<MousePointerClick size={36} />}
            title={menus.length === 0 ? 'No role menus yet' : 'No menus match'}
            description={menus.length === 0 ? 'Create an interactive menu so members can assign their own roles with buttons or a dropdown.' : 'Try a different search or status filter.'}
            action={menus.length === 0 ? <button type="button" onClick={() => setBuilder({ menu: null })} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white" style={{ background: 'var(--p-1)' }}><Plus size={14} /> New menu</button> : undefined}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {filtered.map((menu) => (
              <MenuCard
                key={menu.id}
                menu={menu}
                channelName={channelName(menu.channel_id)}
                assignments={addsByMenu.get(menu.id) ?? 0}
                onEdit={() => setBuilder({ menu })}
                onDuplicate={() => duplicate(menu)}
                onStatus={(s) => setStatus(menu, s)}
                onDelete={() => setConfirm({ menu })}
              />
            ))}
          </div>
        )}
      </CategorySection>

      {builder && (
        <SelfRoleMenuBuilder
          guildId={guildId}
          roles={roles}
          channels={channels}
          menu={builder.menu}
          embedColor={embedColor}
          onClose={() => setBuilder(null)}
          onSaved={onSaved}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={`Delete "${confirm.menu.title}"?`}
          description="This removes the menu and its posted Discord message. Members keep any roles they already have. This can't be undone."
          confirmLabel="Delete menu"
          tone="destructive"
          busy={confirm.busy}
          error={confirm.error}
          onCancel={() => setConfirm(null)}
          onConfirm={doDelete}
        />
      )}
    </div>
  )
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}>{icon}</span>
      <div className="min-w-0">
        <p className="text-2xl font-semibold leading-none text-foreground">{value.toLocaleString()}</p>
        <p className="mt-1 text-xs text-subtle">{label}</p>
      </div>
    </div>
  )
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      role="switch"
      aria-checked={enabled}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
      style={{
        background: enabled ? 'linear-gradient(90deg, var(--p-1), var(--p-2))' : 'var(--bg-2)',
        boxShadow: enabled ? '0 0 12px -2px var(--p-glow)' : 'none',
        border: enabled ? 'none' : '1px solid var(--line-strong)',
      }}
    >
      <span
        className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: enabled ? 'translateX(24px)' : 'translateX(4px)' }}
      />
    </button>
  )
}

function AutoRoleCard({
  guildId,
  roles,
  onToast,
}: {
  guildId: string
  roles: DiscordRole[]
  onToast: (t: Toast) => void
}) {
  const [config, setConfig] = useState<AutoRoleConfig>({ enabled: false, role_id: '' })
  const [snapshot, setSnapshot] = useState<AutoRoleConfig>({ enabled: false, role_id: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    getAutoRole(guildId).then((c) => {
      if (!alive) return
      setConfig(c)
      setSnapshot(c)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [guildId])

  // Assignable roles: skip @everyone and managed (bot/integration) roles, which
  // the bot can't hand out. Highest position first, mirroring Discord's list.
  const assignable = useMemo(
    () => roles.filter((r) => r.name !== '@everyone' && !r.managed).sort((a, b) => b.position - a.position),
    [roles],
  )

  const dirty = config.enabled !== snapshot.enabled || config.role_id !== snapshot.role_id

  async function save() {
    if (config.enabled && !config.role_id) {
      onToast({ kind: 'err', text: 'Pick a role to assign, or turn Auto-role off.' })
      return
    }
    setSaving(true)
    const res = await saveAutoRole(guildId, config)
    setSaving(false)
    if (res.ok) {
      setSnapshot(config)
      onToast({ kind: 'ok', text: 'Auto-role saved.' })
    } else {
      onToast({ kind: 'err', text: res.error })
    }
  }

  if (loading) return <TableSkeleton rows={1} columns={2} />

  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
            <UserPlus size={16} />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Auto-Role</h3>
            <p className="text-sm text-subtle">Assign a role to new members automatically.</p>
          </div>
        </div>
        <Toggle enabled={config.enabled} onChange={(v) => setConfig((c) => ({ ...c, enabled: v }))} />
      </div>

      {config.enabled && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--line-strong)' }}>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Role to assign</label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={config.role_id}
              onChange={(e) => setConfig((c) => ({ ...c, role_id: e.target.value }))}
              className="min-w-[220px] flex-1 rounded-lg border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            >
              <option value="">Select a role</option>
              {assignable.map((r) => (
                <option key={r.id} value={r.id}>@{r.name}</option>
              ))}
            </select>
            {config.role_id && (
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full border"
                style={{ backgroundColor: roleColor(assignable.find((r) => r.id === config.role_id)?.color ?? 0), borderColor: 'var(--line-strong)' }}
              />
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-3">
        {dirty && <span className="text-xs text-subtle">Unsaved changes</span>}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition disabled:opacity-50"
          style={{ background: 'var(--p-1)' }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          Save
        </button>
      </div>
    </div>
  )
}

function RoleBars({ title, rows, muted }: { title: string; rows: { role_id: string; role_name: string; added: number }[]; muted?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.added))
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <p className="mb-3 text-sm font-medium text-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-subtle">No data yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.role_id}>
              <div className="mb-0.5 flex items-center justify-between text-xs">
                <span className="truncate text-foreground">{r.role_name}</span>
                <span className="text-subtle">{r.added.toLocaleString()}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round((r.added / max) * 100)}%`, background: muted ? 'var(--text-3)' : 'var(--p-1)' }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TrendChart({ series }: { series: { date: string; added: number; removed: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.added + s.removed))
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <p className="mb-3 text-sm font-medium text-foreground">Activity — last 14 days</p>
      <div className="flex items-end gap-1" style={{ height: 64 }}>
        {series.map((s) => (
          <div key={s.date} className="flex flex-1 flex-col justify-end" title={`${s.date}: +${s.added} / -${s.removed}`}>
            <div className="w-full rounded-t" style={{ height: `${Math.round((s.added / max) * 100)}%`, minHeight: s.added ? 2 : 0, background: 'var(--p-1)' }} />
            <div className="w-full" style={{ height: `${Math.round((s.removed / max) * 100)}%`, minHeight: s.removed ? 2 : 0, background: 'var(--text-3)' }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3 text-[11px] text-subtle">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: 'var(--p-1)' }} /> Added</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: 'var(--text-3)' }} /> Removed</span>
      </div>
    </div>
  )
}

function MenuCard({
  menu,
  channelName,
  assignments,
  onEdit,
  onDuplicate,
  onStatus,
  onDelete,
}: {
  menu: SelfRoleMenu
  channelName: string | null
  assignments: number
  onEdit: () => void
  onDuplicate: () => void
  onStatus: (s: MenuStatus) => void
  onDelete: () => void
}) {
  const cat = CATEGORY_META[menu.category]
  const status = MENU_STATUS_META[menu.status]
  const jumpUrl = menu.message_id ? `https://discord.com/channels/${menu.guild_id}/${menu.channel_id}/${menu.message_id}` : null

  return (
    <div className="flex flex-col rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{menu.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: `color-mix(in srgb, ${cat.color} 14%, transparent)`, color: cat.color }}>{cat.label}</span>
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: `color-mix(in srgb, ${status.color} 14%, transparent)`, color: status.color }}>{status.label}</span>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-subtle">
          {menu.menu_type === 'buttons' ? <MousePointerClick size={13} /> : <ListChecks size={13} />}
          {MENU_TYPE_META[menu.menu_type].label}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
        <span className="inline-flex items-center gap-1"><Hash size={11} />{channelName ?? 'unknown channel'}</span>
        <span>{menu.roles.length} role{menu.roles.length === 1 ? '' : 's'}</span>
        <span>{assignments.toLocaleString()} self-assignment{assignments === 1 ? '' : 's'}</span>
        <span>Updated {timeAgo(menu.updated_at)}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3" style={{ borderColor: 'var(--line-strong)' }}>
        <CardBtn icon={<Pencil size={13} />} label="Edit" onClick={onEdit} />
        <CardBtn icon={<Copy size={13} />} label="Duplicate" onClick={onDuplicate} />
        {menu.status === 'active' ? (
          <CardBtn icon={<Pause size={13} />} label="Disable" onClick={() => onStatus('disabled')} />
        ) : menu.status !== 'archived' ? (
          <CardBtn icon={<Play size={13} />} label="Publish" onClick={() => onStatus('active')} />
        ) : null}
        {menu.status !== 'archived' && menu.status !== 'draft' && (
          <CardBtn icon={<Archive size={13} />} label="Archive" onClick={() => onStatus('archived')} />
        )}
        {jumpUrl && (
          <a href={jumpUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground" style={{ borderColor: 'var(--line-strong)' }}>
            <ExternalLink size={13} /> View
          </a>
        )}
        <button type="button" onClick={onDelete} className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition hover:text-red-400" style={{ borderColor: 'var(--line-strong)' }}>
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </div>
  )
}

function CardBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground" style={{ borderColor: 'var(--line-strong)' }}>
      {icon} {label}
    </button>
  )
}
