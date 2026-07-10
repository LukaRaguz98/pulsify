'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
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
import { X, Loader2, AlertTriangle, Plus, GripVertical, Search, Check, ChevronDown } from 'lucide-react'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import { PreviewStage } from '@/components/dashboard/onboarding/PreviewStage'
import { roleColor, type DiscordRole } from '@/lib/discord'
import {
  defaultDraft,
  validateDraft,
  normaliseButtonStyle,
  selectionBounds,
  MENU_CATEGORIES,
  CATEGORY_META,
  MENU_TYPE_META,
  SELECTION_MODE_META,
  BUTTON_STYLE_META,
  BUTTON_STYLE_ID,
  MENU_PRESETS,
  SELF_ROLE_LIMITS,
  type MenuDraft,
  type SelfRoleEntry,
  type SelfRoleMenu,
  type MenuType,
  type SelectionMode,
  type MenuCategory,
  type ButtonStyle,
  type RequiredRoleMode,
} from '@/lib/self-roles'

type ChannelOption = { id: string; name: string }

type Props = {
  guildId: string
  roles: DiscordRole[]
  channels: ChannelOption[]
  /** null = creating; otherwise editing this menu. */
  menu: SelfRoleMenu | null
  /** The guild's configured embed accent (`#rrggbb`) — the colour the bot posts
   *  the menu with. Chosen globally in Server Settings › Embed Appearance. */
  embedColor: string
  onClose: () => void
  onSaved: (menu: SelfRoleMenu, isNew: boolean) => void
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

function draftFromMenu(menu: SelfRoleMenu): MenuDraft {
  return {
    title: menu.title,
    description: menu.description ?? '',
    channel_id: menu.channel_id,
    menu_type: menu.menu_type,
    category: menu.category,
    selection_mode: menu.selection_mode,
    min_values: menu.min_values,
    max_values: menu.max_values,
    required_role_ids: menu.required_role_ids,
    required_role_mode: menu.required_role_mode,
    roles: menu.roles,
  }
}

export function SelfRoleMenuBuilder({ guildId, roles, channels, menu, embedColor, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<MenuDraft>(() => (menu ? draftFromMenu(menu) : defaultDraft()))
  const [roleQuery, setRoleQuery] = useState('')
  const [showRolePicker, setShowRolePicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useDialogDismiss(onClose, busy)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles])
  const update = (patch: Partial<MenuDraft>) => setDraft((d) => ({ ...d, ...patch }))

  // Roles still available to add (assignable, not already on the menu).
  const addableRoles = useMemo(() => {
    const taken = new Set(draft.roles.map((r) => r.role_id))
    const q = roleQuery.trim().toLowerCase()
    return roles
      .filter((r) => r.name !== '@everyone' && !r.managed && r.id !== guildId && !taken.has(r.id))
      .filter((r) => (q ? r.name.toLowerCase().includes(q) : true))
      .sort((a, b) => b.position - a.position)
      .slice(0, 40)
  }, [roles, draft.roles, roleQuery, guildId])

  function addRole(role: DiscordRole) {
    if (draft.roles.length >= SELF_ROLE_LIMITS.maxRoles) {
      setError(`A menu can offer at most ${SELF_ROLE_LIMITS.maxRoles} roles.`)
      return
    }
    const entry: SelfRoleEntry = { role_id: role.id, label: role.name.slice(0, SELF_ROLE_LIMITS.maxLabel), button_style: 'secondary' }
    update({ roles: [...draft.roles, entry] })
    setRoleQuery('')
    setShowRolePicker(false)
  }

  function patchRole(roleId: string, patch: Partial<SelfRoleEntry>) {
    update({ roles: draft.roles.map((r) => (r.role_id === roleId ? { ...r, ...patch } : r)) })
  }

  function removeRole(roleId: string) {
    update({ roles: draft.roles.filter((r) => r.role_id !== roleId) })
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = draft.roles.findIndex((r) => r.role_id === active.id)
    const to = draft.roles.findIndex((r) => r.role_id === over.id)
    if (from === -1 || to === -1) return
    update({ roles: arrayMove(draft.roles, from, to) })
  }

  function toggleRequired(roleId: string) {
    const has = draft.required_role_ids.includes(roleId)
    update({
      required_role_ids: has
        ? draft.required_role_ids.filter((id) => id !== roleId)
        : [...draft.required_role_ids, roleId].slice(0, SELF_ROLE_LIMITS.maxRequiredRoles),
    })
  }

  async function save(publish: boolean) {
    const validationError = validateDraft(draft)
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy(true)
    setError(null)

    const payload: Record<string, unknown> = { ...draft }
    let url: string
    let method: 'POST' | 'PATCH'
    if (menu) {
      url = `/api/discord/guild/${guildId}/self-roles/${menu.id}`
      method = 'PATCH'
      // Publishing a draft (or re-publishing) flips status to active; otherwise
      // keep the menu's current status so editing an active menu re-renders it.
      if (publish) payload.status = 'active'
    } else {
      url = `/api/discord/guild/${guildId}/self-roles`
      method = 'POST'
      payload.publish = publish
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Could not save the menu.')
      return
    }
    const saved = (await res.json()) as SelfRoleMenu
    onSaved(saved, !menu)
  }

  if (typeof document === 'undefined') return null

  const isButtons = draft.menu_type === 'buttons'
  const isSelectMulti = draft.menu_type === 'select' && draft.selection_mode === 'multiple'
  const bounds = selectionBounds({ ...draft, roles: draft.roles })

  // Save buttons depend on the menu's current status.
  const status = menu?.status
  const showDraftButton = !menu || status === 'draft'
  const primaryLabel = !menu
    ? 'Publish menu'
    : status === 'draft'
      ? 'Publish'
      : 'Save changes'
  const primaryPublishes = !menu || status === 'draft'

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={menu ? 'Edit role menu' : 'Create role menu'}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <h2 className="font-semibold text-foreground">{menu ? 'Edit role menu' : 'New role menu'}</h2>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
            {/* ── Form column ─────────────────────────────────────────── */}
            <div className="space-y-5">
              {/* Presets (create only) */}
              {!menu && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Start from a preset</label>
                  <div className="flex flex-wrap gap-1.5">
                    {MENU_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => update({ ...defaultDraft(), ...p.draft, roles: draft.roles, channel_id: draft.channel_id })}
                        className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                        style={{ borderColor: 'var(--line-strong)' }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Title */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Title</label>
                <input
                  value={draft.title}
                  onChange={(e) => update({ title: e.target.value })}
                  maxLength={SELF_ROLE_LIMITS.maxTitle}
                  placeholder="e.g. Notification roles"
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                  style={fieldStyle}
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Description (optional)</label>
                <textarea
                  value={draft.description}
                  onChange={(e) => update({ description: e.target.value })}
                  maxLength={SELF_ROLE_LIMITS.maxDescription}
                  rows={2}
                  placeholder="Tell members what these roles are for."
                  className="w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                  style={fieldStyle}
                />
              </div>

              {/* Channel + category */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Channel</label>
                  <select value={draft.channel_id} onChange={(e) => update({ channel_id: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle}>
                    <option value="">Select a channel…</option>
                    {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Category</label>
                  <select value={draft.category} onChange={(e) => update({ category: e.target.value as MenuCategory })} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle}>
                    {MENU_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
                  </select>
                </div>
              </div>

              {/* Menu type + selection mode */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Control</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(MENU_TYPE_META) as MenuType[]).map((t) => (
                      <button key={t} type="button" onClick={() => update({ menu_type: t })} className="rounded-lg border px-2 py-1.5 text-xs font-medium transition" style={draft.menu_type === t ? { background: 'var(--p-soft)', color: 'var(--p-1)', borderColor: 'var(--p-1)' } : { ...fieldStyle, color: 'var(--text-2)' }}>
                        {MENU_TYPE_META[t].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Selection</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(SELECTION_MODE_META) as SelectionMode[]).map((m) => (
                      <button key={m} type="button" onClick={() => update({ selection_mode: m })} className="rounded-lg border px-2 py-1.5 text-xs font-medium transition" style={draft.selection_mode === m ? { background: 'var(--p-soft)', color: 'var(--p-1)', borderColor: 'var(--p-1)' } : { ...fieldStyle, color: 'var(--text-2)' }}>
                        {SELECTION_MODE_META[m].label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <p className="-mt-2 text-xs" style={{ color: 'var(--text-3)' }}>
                {SELECTION_MODE_META[draft.selection_mode].description} {MENU_TYPE_META[draft.menu_type].description}
              </p>

              {/* min/max for a multi-select menu */}
              {isSelectMulti && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Min selections</label>
                    <input type="number" min={0} max={draft.roles.length || 1} value={draft.min_values} onChange={(e) => update({ min_values: Math.max(0, Number(e.target.value) || 0) })} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Max selections (0 = all)</label>
                    <input type="number" min={0} max={draft.roles.length || 1} value={draft.max_values} onChange={(e) => update({ max_values: Math.max(0, Number(e.target.value) || 0) })} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle} />
                  </div>
                </div>
              )}

              {/* ── Roles ─────────────────────────────────────────────── */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Roles ({draft.roles.length}/{SELF_ROLE_LIMITS.maxRoles})</label>
                  <button type="button" onClick={() => setShowRolePicker((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground" style={{ borderColor: 'var(--line-strong)' }}>
                    <Plus size={12} /> Add role
                  </button>
                </div>

                {showRolePicker && (
                  <div className="mb-2 rounded-lg border p-2" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                      <input value={roleQuery} onChange={(e) => setRoleQuery(e.target.value)} placeholder="Search roles…" autoFocus className="w-full rounded-md border py-1.5 pl-8 pr-3 text-sm focus:outline-none" style={fieldStyle} />
                    </div>
                    <div className="mt-1.5 max-h-40 overflow-y-auto">
                      {addableRoles.length === 0 ? (
                        <p className="px-2 py-2 text-xs" style={{ color: 'var(--text-3)' }}>No assignable roles match.</p>
                      ) : addableRoles.map((r) => (
                        <button key={r.id} type="button" onClick={() => addRole(r)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-[var(--panel)]">
                          <span className="h-3 w-3 shrink-0 rounded-full border" style={{ backgroundColor: roleColor(r.color), borderColor: 'var(--line-strong)' }} />
                          <span className="truncate text-foreground">@{r.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {draft.roles.length === 0 ? (
                  <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
                    No roles yet — add the roles members can self-assign.
                  </div>
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={draft.roles.map((r) => r.role_id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-1.5">
                        {draft.roles.map((entry) => (
                          <RoleRow
                            key={entry.role_id}
                            entry={entry}
                            role={roleById.get(entry.role_id)}
                            showStyle={isButtons}
                            onPatch={(patch) => patchRole(entry.role_id, patch)}
                            onRemove={() => removeRole(entry.role_id)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>

              {/* ── Access (required roles) ───────────────────────────── */}
              <div>
                <RequiredRolesField
                  roles={roles.filter((r) => r.name !== '@everyone' && r.id !== guildId)}
                  selected={draft.required_role_ids}
                  mode={draft.required_role_mode}
                  onToggle={toggleRequired}
                  onMode={(m) => update({ required_role_mode: m })}
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
                </div>
              )}
            </div>

            {/* ── Preview column ──────────────────────────────────────── */}
            <div className="lg:sticky lg:top-0 lg:self-start">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Preview</label>
              <MenuPreview draft={draft} bounds={bounds} accent={embedColor} />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50" style={{ borderColor: 'var(--line-strong)' }}>Cancel</button>
          {showDraftButton && (
            <button type="button" onClick={() => save(false)} disabled={busy} className="rounded-lg border px-3 py-1.5 text-sm font-medium text-foreground transition disabled:opacity-50" style={{ borderColor: 'var(--line-strong)' }}>
              Save as draft
            </button>
          )}
          <button type="button" onClick={() => save(primaryPublishes)} disabled={busy} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
            {busy && <Loader2 size={13} className="animate-spin" />} {primaryLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Sortable role row ──────────────────────────────────────────────────────────

function RoleRow({
  entry,
  role,
  showStyle,
  onPatch,
  onRemove,
}: {
  entry: SelfRoleEntry
  role?: DiscordRole
  showStyle: boolean
  onPatch: (patch: Partial<SelfRoleEntry>) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.role_id })
  const [open, setOpen] = useState(false)
  const styles: ButtonStyle[] = ['primary', 'secondary', 'success', 'danger']

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
      className="rounded-lg border p-2"
    >
      <div className="flex items-center gap-2">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground active:cursor-grabbing" aria-label="Drag to reorder"><GripVertical size={14} /></button>
        <span className="h-3 w-3 shrink-0 rounded-full border" style={{ backgroundColor: role ? roleColor(role.color) : '#99aab5', borderColor: 'var(--line-strong)' }} />
        <span className="w-28 shrink-0 truncate text-xs text-muted-foreground" title={role ? `@${role.name}` : entry.role_id}>@{role?.name ?? 'unknown'}</span>
        <input
          value={entry.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          maxLength={SELF_ROLE_LIMITS.maxLabel}
          placeholder="Button label"
          className="min-w-0 flex-1 rounded-md border px-2 py-1 text-sm focus:outline-none"
          style={fieldStyle}
        />
        <input
          value={entry.emoji ?? ''}
          onChange={(e) => onPatch({ emoji: e.target.value || undefined })}
          placeholder="😀"
          className="w-14 rounded-md border px-2 py-1 text-center text-sm focus:outline-none"
          style={fieldStyle}
          title="Emoji — a unicode emoji or <:name:id>"
        />
        <button type="button" onClick={() => setOpen((v) => !v)} className="rounded p-1 text-muted-foreground transition hover:text-foreground" aria-label="More options"><ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} /></button>
        <button type="button" onClick={onRemove} className="rounded p-1 text-muted-foreground transition hover:text-red-400" aria-label="Remove role"><X size={14} /></button>
      </div>

      {open && (
        <div className="mt-2 space-y-2 pl-6">
          <input
            value={entry.description ?? ''}
            onChange={(e) => onPatch({ description: e.target.value || undefined })}
            maxLength={SELF_ROLE_LIMITS.maxRoleDescription}
            placeholder="Short description (shown on select menus)"
            className="w-full rounded-md border px-2 py-1 text-sm focus:outline-none"
            style={fieldStyle}
          />
          {showStyle && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Button colour</span>
              {styles.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onPatch({ button_style: normaliseButtonStyle(s) })}
                  className="h-5 w-5 rounded-full border-2 transition"
                  style={{ background: BUTTON_STYLE_META[s].swatch, borderColor: entry.button_style === s ? 'var(--text)' : 'transparent' }}
                  title={BUTTON_STYLE_META[s].label}
                  aria-label={BUTTON_STYLE_META[s].label}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Required-roles multi-select ────────────────────────────────────────────────

function RequiredRolesField({
  roles,
  selected,
  mode,
  onToggle,
  onMode,
}: {
  roles: DiscordRole[]
  selected: string[]
  mode: RequiredRoleMode
  onToggle: (id: string) => void
  onMode: (m: RequiredRoleMode) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase()
    return roles.filter((r) => (query ? r.name.toLowerCase().includes(query) : true)).sort((a, b) => b.position - a.position).slice(0, 30)
  }, [roles, q])

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Required to use (optional)</label>
        {selected.length > 1 && (
          <div className="flex overflow-hidden rounded-md border text-xs" style={{ borderColor: 'var(--line-strong)' }}>
            {(['any', 'all'] as RequiredRoleMode[]).map((m) => (
              <button key={m} type="button" onClick={() => onMode(m)} className="px-2 py-0.5 capitalize" style={mode === m ? { background: 'var(--p-soft)', color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{m}</button>
            ))}
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const r = roles.find((x) => x.id === id)
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-foreground" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
                @{r?.name ?? 'role'}
                <button type="button" onClick={() => onToggle(id)} className="text-muted-foreground hover:text-foreground" aria-label="Remove"><X size={11} /></button>
              </span>
            )
          })}
        </div>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground" style={{ borderColor: 'var(--line-strong)' }}>
        <Plus size={12} /> {selected.length ? 'Add another' : 'Add required role'}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border p-2" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search roles…" autoFocus className="w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none" style={fieldStyle} />
          <div className="mt-1.5 max-h-36 overflow-y-auto">
            {matches.map((r) => {
              const on = selected.includes(r.id)
              return (
                <button key={r.id} type="button" onClick={() => onToggle(r.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-[var(--panel)]">
                  <span className="flex h-4 w-4 items-center justify-center rounded border" style={{ background: on ? 'var(--p-1)' : 'transparent', borderColor: on ? 'var(--p-1)' : 'var(--line-strong)', color: '#fff' }}>{on && <Check size={11} />}</span>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: roleColor(r.color) }} />
                  <span className="truncate text-foreground">@{r.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Live Discord-style preview ─────────────────────────────────────────────────

const DISCORD_BTN_BG: Record<number, string> = {
  1: '#5865f2',
  2: '#4e5058',
  3: '#248046',
  4: '#da373c',
}

function MenuPreview({ draft, bounds, accent }: { draft: MenuDraft; bounds: { min: number; max: number }; accent: string }) {
  // The accent stripe uses the guild's configured embed colour (Server Settings
  // › Embed Appearance) — the exact colour the bot posts the menu with — not the
  // category colour, so the preview matches Discord.
  const described = draft.roles.filter((r) => r.description)

  // The builder is a client-only modal (renders null during SSR), so computing
  // the timestamp once on mount via a lazy initializer is hydration-safe and
  // avoids an effect.
  const [timeStr] = useState(() => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))

  // Same floating glass V2 container the onboarding / messages previews use: the
  // card is transparent so the animated PreviewStage field glows through the
  // translucent, blurred container with its left accent stripe.
  return (
    <PreviewStage>
      <div style={{ fontFamily: "'gg sans', 'Noto Sans', Arial, sans-serif" }}>
        <div className="flex items-start gap-2.5 sm:gap-4">
          {/* Bot avatar */}
          <Image
            src="/logo.png"
            alt="Pulse"
            width={40}
            height={40}
            className="h-9 w-9 sm:h-10 sm:w-10"
            style={{ flexShrink: 0, borderRadius: '50%', marginTop: '2px', objectFit: 'cover' }}
          />

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Username row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: '14px' }}>Pulse</span>
              <span style={{
                background: '#5865f2', color: '#ffffff',
                borderRadius: '3px', padding: '1px 5px',
                fontSize: '9px', fontWeight: 700,
                letterSpacing: '0.4px', textTransform: 'uppercase', lineHeight: '1.4',
              }}>APP</span>
              <span style={{ color: 'var(--text-3)', fontSize: '12px' }}>Today at {timeStr}</span>
            </div>

            {/* Translucent glass V2 container */}
            <div style={{
              background: 'color-mix(in srgb, var(--panel-2) 55%, transparent)',
              border: '1px solid var(--line)',
              borderLeftWidth: '3px',
              borderLeftColor: accent,
              borderRadius: '8px',
              overflow: 'hidden',
              maxWidth: '520px',
              padding: '12px 16px',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: '0 20px 55px -26px color-mix(in srgb, var(--text) 30%, transparent)',
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
            }}>
              {/* Pulse label — matches the `**Pulse**` line the bot opens with. */}
              <div style={{ color: 'var(--text-2)', fontWeight: 700, fontSize: '12px', marginBottom: '2px' }}>Pulse</div>

              {/* Title — H1 heading */}
              <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: '20px', margin: '0 0 6px', lineHeight: '1.3' }}>
                {draft.title || 'Title'}
              </div>

              {/* Description */}
              {draft.description && (
                <div style={{ color: 'var(--text-2)', fontSize: '14px', margin: '0 0 10px', lineHeight: '1.45' }}>
                  {draft.description}
                </div>
              )}

              {/* Per-role descriptions (buttons list them above the controls) */}
              {draft.menu_type === 'buttons' && described.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}>
                  {described.map((r) => (
                    <div key={r.role_id} style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: '1.4' }}>
                      {r.emoji ? `${r.emoji} ` : ''}<strong style={{ color: 'var(--text)' }}>{r.label}</strong> — {r.description}
                    </div>
                  ))}
                </div>
              )}

              {/* Controls */}
              {draft.roles.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--text-3)' }}>Add roles to see the controls.</div>
              ) : draft.menu_type === 'buttons' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {draft.roles.map((r) => (
                    <span
                      key={r.role_id}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        borderRadius: '4px', padding: '6px 12px',
                        fontSize: '13px', fontWeight: 500, color: '#ffffff',
                        background: DISCORD_BTN_BG[BUTTON_STYLE_ID[r.button_style]],
                      }}
                    >
                      {r.emoji ? <span>{r.emoji}</span> : null}{r.label}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  borderRadius: '4px', border: '1px solid var(--line-strong)',
                  background: 'color-mix(in srgb, var(--panel-2) 60%, transparent)',
                  padding: '8px 12px', fontSize: '13px', color: 'var(--text-3)',
                }}>
                  <span>{draft.selection_mode === 'single' ? 'Pick a role' : `Pick your roles${bounds.max > 1 ? ` (up to ${bounds.max})` : ''}`}</span>
                  <span>▾</span>
                </div>
              )}

              {/* Divider + footer — the standardized Pulse v2 close. */}
              <div style={{ borderTop: '1px solid var(--line-strong)', margin: '12px 0 8px' }} />
              <div style={{ color: 'var(--text-3)', fontSize: '12px', lineHeight: '1.3' }}>Pulse — Self Roles</div>
            </div>
          </div>
        </div>
      </div>
    </PreviewStage>
  )
}
