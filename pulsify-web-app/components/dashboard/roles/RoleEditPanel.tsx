'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  X,
  Loader2,
  Trash2,
  Copy,
  AlertTriangle,
  Check,
  Save,
  Bookmark,
  Tag,
  Palette,
  Eye,
  ShieldCheck,
} from 'lucide-react'
import type { DiscordRole } from '@/lib/discord'
import {
  bitsFromPermissionKeys,
  permissionKeysFromBits,
  dangerousKeysIn,
} from '@/lib/discord-permissions'
import { PermissionList } from './PermissionList'
import { DISCORD_ROLE_COLORS, hexString, parseHex } from './colors'
import type { PermissionPreset } from '@/app/api/guilds/[guildId]/permission-presets/route'

export type RoleDraft = {
  name: string
  color: number
  permissionKeys: Set<string>
  hoist: boolean
  mentionable: boolean
}

type Props = {
  guildId: string
  role: DiscordRole | null
  isCreating: boolean
  presets: PermissionPreset[]
  onClose: () => void
  onSaved: (role: DiscordRole, isNew: boolean) => void
  onDeleted: (roleId: string) => void
  onDuplicated: (role: DiscordRole) => void
  onPresetsChanged: () => void
}

function isCustomColor(hex: number): boolean {
  return !DISCORD_ROLE_COLORS.some((c) => c.hex === hex)
}

function emptyDraft(): RoleDraft {
  return {
    name: 'new-role',
    color: 0,
    permissionKeys: new Set(),
    hoist: false,
    mentionable: false,
  }
}

function draftFromRole(role: DiscordRole): RoleDraft {
  return {
    name: role.name,
    color: role.color,
    permissionKeys: new Set(permissionKeysFromBits(role.permissions)),
    hoist: role.hoist,
    mentionable: role.mentionable,
  }
}

export function RoleEditPanel({
  guildId,
  role,
  isCreating,
  presets,
  onClose,
  onSaved,
  onDeleted,
  onDuplicated,
  onPresetsChanged,
}: Props) {
  const [draft, setDraft] = useState<RoleDraft>(() =>
    role ? draftFromRole(role) : emptyDraft(),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [savePresetOpen, setSavePresetOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [hexInput, setHexInput] = useState(() => hexString(role?.color ?? 0))

  useEffect(() => {
    setDraft(role ? draftFromRole(role) : emptyDraft())
    setHexInput(hexString(role?.color ?? 0))
    setError(null)
    setSuccess(null)
    setConfirmDelete(false)
    setSavePresetOpen(false)
  }, [role?.id, isCreating])

  // While the slide-over is mounted, hide the top-right corner decoration so
  // its extended bracket doesn't paint across the dialog. Class is scoped to
  // body so it survives unrelated re-renders.
  useEffect(() => {
    document.body.classList.add('slide-over-open')
    return () => document.body.classList.remove('slide-over-open')
  }, [])

  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => setSuccess(null), 3000)
    return () => clearTimeout(t)
  }, [success])

  // Discord won't let us edit managed roles, the @everyone role, or roles at
  // or above the bot's highest role. We let the API surface the precise error
  // but gray out the editor up front for managed roles.
  const isManaged = role?.managed ?? false
  const isEveryone = role?.name === '@everyone'
  const readOnly = isManaged || isEveryone

  const dangerous = useMemo(
    () => dangerousKeysIn(draft.permissionKeys),
    [draft.permissionKeys],
  )

  function togglePermission(key: string, next: boolean) {
    setDraft((prev) => {
      const keys = new Set(prev.permissionKeys)
      if (next) keys.add(key)
      else keys.delete(key)
      return { ...prev, permissionKeys: keys }
    })
  }

  function applyPreset(preset: PermissionPreset) {
    const keys = new Set(permissionKeysFromBits(preset.permissions))
    setDraft((prev) => ({ ...prev, permissionKeys: keys }))
    setSuccess(`Applied "${preset.name}" preset.`)
  }

  async function save() {
    setBusy(true)
    setError(null)
    setSuccess(null)
    const body = {
      name: draft.name.trim() || 'new-role',
      color: draft.color,
      permissions: bitsFromPermissionKeys(draft.permissionKeys),
      hoist: draft.hoist,
      mentionable: draft.mentionable,
    }
    try {
      const res = isCreating
        ? await fetch(`/api/discord/guild/${guildId}/roles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch(`/api/discord/guild/${guildId}/roles/${role!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? `Discord rejected the change (${res.status}).`)
        setBusy(false)
        return
      }
      const saved = (await res.json()) as DiscordRole
      setSuccess(isCreating ? 'Role created.' : 'Role updated.')
      onSaved(saved, isCreating)
    } finally {
      setBusy(false)
    }
  }

  async function duplicate() {
    if (!role) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/discord/guild/${guildId}/roles/${role.id}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Duplication failed.')
      return
    }
    onDuplicated((await res.json()) as DiscordRole)
  }

  async function remove() {
    if (!role) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/discord/guild/${guildId}/roles/${role.id}`, {
      method: 'DELETE',
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Delete failed.')
      return
    }
    onDeleted(role.id)
  }

  async function savePreset() {
    const name = presetName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/guilds/${guildId}/permission-presets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        permissions: bitsFromPermissionKeys(draft.permissionKeys),
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Could not save preset.')
      return
    }
    setSavePresetOpen(false)
    setPresetName('')
    setSuccess(`Saved "${name}" preset.`)
    onPresetsChanged()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onClose()}
    >
      <aside
        role="dialog"
        aria-label={isCreating ? 'Create role' : `Edit role ${role?.name ?? ''}`}
        className="relative flex w-full max-w-2xl max-h-[90vh] flex-col rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: 'var(--line-strong)' }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="h-3.5 w-3.5 rounded-full border shrink-0"
              style={{
                backgroundColor: draft.color === 0 ? 'transparent' : hexString(draft.color),
                borderColor: 'var(--line-strong)',
              }}
            />
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-foreground">
                {isCreating ? 'Create role' : `Edit @${role?.name ?? ''}`}
              </h2>
              {readOnly && (
                <p className="text-xs text-subtle">
                  {isManaged ? 'Managed by an integration — read only.' : 'Cannot edit @everyone here.'}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Status banners */}
          {error && (
            <div
              className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
            >
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div
              className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: 'rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.08)', color: '#4ade80' }}
            >
              <Check size={12} className="mt-0.5 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* Name */}
          <Section icon={<Tag size={13} />} label="Role name" description="What members see in the role list.">
            <input
              type="text"
              value={draft.name}
              maxLength={100}
              disabled={readOnly || busy}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          </Section>

          {/* Color */}
          <Section icon={<Palette size={13} />} label="Role color" description="Pick a preset or a custom hex value.">
            {/* Circular swatches matching Preferences › App Design + Pulse
                Assistant. Active state uses an outline ring instead of an
                inner check so the geometry stays uniform across the app. */}
            <div className="flex flex-wrap items-center gap-2.5">
              {DISCORD_ROLE_COLORS.map((c) => {
                const isActive = draft.color === c.hex
                const ringColor = c.hex === 0 ? 'var(--text-3)' : hexString(c.hex)
                return (
                  <button
                    key={c.hex}
                    type="button"
                    disabled={readOnly || busy}
                    onClick={() => {
                      setDraft((d) => ({ ...d, color: c.hex }))
                      setHexInput(hexString(c.hex))
                    }}
                    title={c.label}
                    className="h-7 w-7 rounded-full transition-all hover:scale-110 shrink-0 disabled:opacity-50 disabled:hover:scale-100"
                    style={{
                      background: c.hex === 0 ? 'transparent' : hexString(c.hex),
                      // Dashed border keeps the "Default" (transparent) swatch
                      // visible against the panel background.
                      border: c.hex === 0 ? '1px dashed var(--line-strong)' : 'none',
                      outline: isActive ? `2px solid ${ringColor}` : '2px solid transparent',
                      outlineOffset: '2px',
                    }}
                  />
                )
              })}
              {/* Custom color picker — same pattern as Pulse Assistant. Native
                  <input type="color"> hidden behind a conic-gradient swatch;
                  outline lights up when the current color isn't a preset. */}
              <label
                title="Custom color"
                aria-label="Pick a custom color"
                className="relative h-7 w-7 rounded-full shrink-0"
                style={{
                  background: 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #ec4899, #f43f5e)',
                  outline: isCustomColor(draft.color) ? `2px solid ${hexString(draft.color)}` : '2px solid transparent',
                  outlineOffset: '2px',
                  cursor: readOnly || busy ? 'not-allowed' : 'pointer',
                  opacity: readOnly || busy ? 0.5 : 1,
                }}
              >
                <input
                  type="color"
                  value={hexString(draft.color)}
                  disabled={readOnly || busy}
                  onChange={(e) => {
                    const parsed = parseHex(e.target.value)
                    if (parsed !== null) {
                      setDraft((d) => ({ ...d, color: parsed }))
                      setHexInput(hexString(parsed))
                    }
                  }}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                />
              </label>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-subtle">Hex</span>
              <input
                type="text"
                value={hexInput}
                disabled={readOnly || busy}
                onChange={(e) => {
                  const v = e.target.value
                  setHexInput(v.startsWith('#') ? v : `#${v}`)
                  const parsed = parseHex(v)
                  if (parsed !== null) setDraft((d) => ({ ...d, color: parsed }))
                }}
                className="w-28 rounded border px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </div>
          </Section>

          {/* Display options */}
          <Section icon={<Eye size={13} />} label="Display" description="How this role appears in the member list and mentions.">
            <Toggle
              label="Display role members separately from online members"
              description="Members with this role show up in their own sidebar group (hoist)."
              checked={draft.hoist}
              disabled={readOnly || busy}
              onChange={(v) => setDraft((d) => ({ ...d, hoist: v }))}
            />
            <Toggle
              label="Allow anyone to @mention this role"
              description="When off, only members with Mention Everyone can ping this role."
              checked={draft.mentionable}
              disabled={readOnly || busy}
              onChange={(v) => setDraft((d) => ({ ...d, mentionable: v }))}
            />
          </Section>

          {/* Permissions */}
          <Section
            icon={<ShieldCheck size={13} />}
            label="Permissions"
            description="What members of this role are allowed to do."
          >
            <PermissionList
              selected={draft.permissionKeys}
              onToggle={togglePermission}
              disabled={readOnly || busy}
              toolbarRight={
                <PresetDropdown
                  presets={presets}
                  onApply={applyPreset}
                  disabled={readOnly || busy}
                />
              }
            />

            {dangerous.length > 0 && (
              <div
                className="mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
                style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}
              >
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <div>
                  <strong>Dangerous permissions enabled:</strong>{' '}
                  {dangerous.map((d) => d.label).join(', ')}.
                  <p className="mt-1 text-[11px] opacity-80">
                    These can be misused to harm the server. Only assign to trusted members.
                  </p>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSavePresetOpen(true)}
              disabled={readOnly || busy || draft.permissionKeys.size === 0}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:bg-[var(--bg-2)] disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <Bookmark size={12} />
              Save current permissions as preset
            </button>

            {savePresetOpen && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Preset name"
                  maxLength={100}
                  className="flex-1 rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1"
                  style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                />
                <button
                  type="button"
                  onClick={savePreset}
                  disabled={busy || !presetName.trim()}
                  className="rounded px-2 py-1 text-xs font-medium disabled:opacity-50"
                  style={{ background: 'var(--p-1)', color: '#fff' }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => { setSavePresetOpen(false); setPresetName('') }}
                  className="text-xs text-muted-foreground"
                >
                  Cancel
                </button>
              </div>
            )}
          </Section>
        </div>

        {/* Footer actions */}
        <footer
          className="flex items-center justify-between gap-2 border-t px-5 py-3"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
        >
          <div className="flex items-center gap-2">
            {!isCreating && !readOnly && role && (
              <>
                <button
                  type="button"
                  onClick={duplicate}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:bg-[var(--panel)] disabled:opacity-50"
                  style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                >
                  <Copy size={12} />
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50"
                  style={{
                    borderColor: 'rgba(239,68,68,0.35)',
                    background: 'rgba(239,68,68,0.08)',
                    color: '#f87171',
                  }}
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={readOnly || busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
              style={{ background: 'var(--p-1)', color: '#fff' }}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {isCreating ? 'Create role' : 'Save changes'}
            </button>
          </div>
        </footer>

        {confirmDelete && role && (
          <DeleteConfirm
            roleName={role.name}
            busy={busy}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={remove}
          />
        )}
      </aside>
    </div>
  )
}

function Section({
  icon,
  label,
  description,
  right,
  children,
}: {
  icon: React.ReactNode
  label: string
  description?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  // Mirrors the CategorySection used in Moderation / Statistics: icon chip,
  // uppercase title, optional description, horizontal divider that grows to
  // fill the row. `right` keeps the inline action slot used by the preset
  // dropdown.
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: 'var(--bg-2)',
            color: 'var(--text-3)',
            border: '1px solid var(--line-strong)',
          }}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h3
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--text-2)' }}
          >
            {label}
          </h3>
          {description && <p className="text-xs text-subtle">{description}</p>}
        </div>
        <div className="ml-1 h-px flex-1" style={{ background: 'var(--line-strong)' }} />
        {right && <div className="shrink-0">{right}</div>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      className="mb-2 flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 last:mb-0"
      style={{
        borderColor: 'var(--line-strong)',
        background: 'var(--bg-2)',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[var(--p-1)]"
      />
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {description && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
        )}
      </div>
    </label>
  )
}

function PresetDropdown({
  presets,
  onApply,
  disabled,
}: {
  presets: PermissionPreset[]
  onApply: (preset: PermissionPreset) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || presets.length === 0}
        className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-medium uppercase tracking-wider transition hover:bg-[var(--bg-2)] disabled:opacity-50"
        style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
      >
        Apply preset
      </button>
      {open && (
        <div
          className="absolute right-0 z-30 mt-1 w-56 rounded-lg border py-1 shadow-xl"
          style={{ background: 'var(--panel-2)', borderColor: 'var(--line-strong)' }}
        >
          {presets.length === 0 ? (
            <p className="px-3 py-2 text-xs text-subtle">No presets yet.</p>
          ) : (
            presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onApply(p); setOpen(false) }}
                className="flex w-full flex-col items-start px-3 py-1.5 text-left text-xs transition hover:bg-[var(--bg-2)]"
                style={{ color: 'var(--text)' }}
              >
                <span className="font-medium">
                  {p.name}
                  {p.is_default && (
                    <span className="ml-1.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                      Default
                    </span>
                  )}
                </span>
                {p.description && (
                  <span className="text-[10px] text-subtle line-clamp-1">{p.description}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function DeleteConfirm({
  roleName,
  busy,
  onCancel,
  onConfirm,
}: {
  roleName: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
    >
      <div
        className="w-full max-w-sm rounded-xl border p-5 shadow-xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <h3 className="mb-2 font-semibold text-foreground">Delete @{roleName}?</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          This removes the role from every member who has it. The action cannot be undone.
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
            style={{ background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.5)', color: '#f87171' }}
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            Delete role
          </button>
        </div>
      </div>
    </div>
  )
}
