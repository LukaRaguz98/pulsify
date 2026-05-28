'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  X,
  Loader2,
  Trash2,
  AlertTriangle,
  Check,
  Save,
  Hash,
  AlignLeft,
  Folder,
  Volume2,
  Mic2,
  Megaphone,
  MessageSquare,
  Image as ImageIcon,
  Plus,
  Copy,
  Shield,
  Users,
  EyeOff,
  Lock,
} from 'lucide-react'
import {
  CHANNEL_TYPES,
  roleColor,
  type DiscordChannel,
  type DiscordRole,
  type CreatableChannelType,
  type DiscordPermissionOverwrite,
} from '@/lib/discord'
import { PERMISSION_CATEGORIES, type PermissionDef } from '@/lib/discord-permissions'

type Toast = { kind: 'ok' | 'err'; text: string }

type Draft = {
  name: string
  topic: string
  nsfw: boolean
  rate_limit_per_user: number
  bitrate: number
  user_limit: number
  parent_id: string | null
}

type Props = {
  guildId: string
  channel: DiscordChannel | null
  createDraft: { type: CreatableChannelType; parentId: string | null } | null
  channels: DiscordChannel[]
  roles: DiscordRole[]
  onClose: () => void
  onSaved: (channel: DiscordChannel, isNew: boolean) => void
  onDeleted: (id: string) => void
  onDuplicated: (channel: DiscordChannel) => void
}

const TYPE_META: Record<number, { label: string; icon: React.ReactNode; sub: string }> = {
  [CHANNEL_TYPES.TEXT]:         { label: 'Text channel',    icon: <Hash size={14} />,         sub: 'Send messages, images, links and more.' },
  [CHANNEL_TYPES.VOICE]:        { label: 'Voice channel',   icon: <Volume2 size={14} />,      sub: 'Hop in to talk, share screen and stream.' },
  [CHANNEL_TYPES.CATEGORY]:     { label: 'Category',        icon: <Folder size={14} />,       sub: 'Group channels under a heading.' },
  [CHANNEL_TYPES.ANNOUNCEMENT]: { label: 'Announcement',    icon: <Megaphone size={14} />,    sub: 'Post updates that subscribed servers can follow.' },
  [CHANNEL_TYPES.STAGE]:        { label: 'Stage',           icon: <Mic2 size={14} />,         sub: 'Host audio events with speakers and audience.' },
  [CHANNEL_TYPES.FORUM]:        { label: 'Forum',           icon: <MessageSquare size={14} />, sub: 'Threaded community discussion organized by topic.' },
  [CHANNEL_TYPES.MEDIA]:        { label: 'Media',           icon: <ImageIcon size={14} />,    sub: 'Image-and-video gallery channel.' },
}

const SLOWMODE_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 5, label: '5s' },
  { value: 10, label: '10s' },
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
  { value: 900, label: '15m' },
  { value: 1800, label: '30m' },
  { value: 3600, label: '1h' },
  { value: 7200, label: '2h' },
  { value: 21600, label: '6h' },
]

const BITRATE_OPTIONS = [
  { value: 8000,  label: '8 kbps' },
  { value: 16000, label: '16 kbps' },
  { value: 32000, label: '32 kbps' },
  { value: 64000, label: '64 kbps' },
  { value: 96000, label: '96 kbps' },
  { value: 128000, label: '128 kbps (Server boost)' },
  { value: 256000, label: '256 kbps (Server boost L2)' },
  { value: 384000, label: '384 kbps (Server boost L3)' },
]

function emptyDraft(): Draft {
  return {
    name: '',
    topic: '',
    nsfw: false,
    rate_limit_per_user: 0,
    bitrate: 64000,
    user_limit: 0,
    parent_id: null,
  }
}

function draftFromChannel(c: DiscordChannel): Draft {
  return {
    name: c.name,
    topic: c.topic ?? '',
    nsfw: c.nsfw ?? false,
    rate_limit_per_user: c.rate_limit_per_user ?? 0,
    bitrate: c.bitrate ?? 64000,
    user_limit: c.user_limit ?? 0,
    parent_id: c.parent_id ?? null,
  }
}

export function ChannelEditPanel({
  guildId, channel, createDraft, channels, roles, onClose, onSaved, onDeleted, onDuplicated,
}: Props) {
  const isCreating = createDraft !== null
  const channelType = channel?.type ?? createDraft?.type ?? CHANNEL_TYPES.TEXT
  const meta = TYPE_META[channelType] ?? TYPE_META[CHANNEL_TYPES.TEXT]

  const [draft, setDraft] = useState<Draft>(() => {
    if (channel) return draftFromChannel(channel)
    const init = emptyDraft()
    if (createDraft) init.parent_id = createDraft.parentId
    return init
  })
  const [overwrites, setOverwrites] = useState<DiscordPermissionOverwrite[]>(
    channel?.permission_overwrites ?? [],
  )
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Parent uses a `key` prop to remount this component when the user switches
  // channels — so initial state derives from props in useState above, and we
  // don't need a sync useEffect here.

  useEffect(() => {
    document.body.classList.add('slide-over-open')
    return () => document.body.classList.remove('slide-over-open')
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const isCategory = channelType === CHANNEL_TYPES.CATEGORY
  const isVoiceLike = channelType === CHANNEL_TYPES.VOICE || channelType === CHANNEL_TYPES.STAGE
  const isTextLike = channelType === CHANNEL_TYPES.TEXT
    || channelType === CHANNEL_TYPES.ANNOUNCEMENT
    || channelType === CHANNEL_TYPES.FORUM
    || channelType === CHANNEL_TYPES.MEDIA

  const availableCategories = useMemo(
    () => channels
      .filter((c) => c.type === CHANNEL_TYPES.CATEGORY)
      .sort((a, b) => a.position - b.position),
    [channels],
  )

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function save() {
    if (!draft.name.trim()) {
      setToast({ kind: 'err', text: 'Name is required.' })
      return
    }
    setBusy(true)
    const body: Record<string, unknown> = { name: draft.name.trim() }
    if (isTextLike || isVoiceLike) {
      body.topic = draft.topic.trim() || null
    }
    if (isTextLike) {
      body.nsfw = draft.nsfw
      body.rate_limit_per_user = draft.rate_limit_per_user
    }
    if (isVoiceLike) {
      body.bitrate = draft.bitrate
      body.user_limit = draft.user_limit
    }
    if (!isCategory) body.parent_id = draft.parent_id

    try {
      const url = isCreating
        ? `/api/discord/guild/${guildId}/channels`
        : `/api/discord/guild/${guildId}/channels/${channel!.id}`
      const method = isCreating ? 'POST' : 'PATCH'
      if (isCreating) body.type = channelType

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setToast({ kind: 'err', text: data.error ?? `Discord rejected the change (${res.status}).` })
        return
      }
      const saved = (await res.json()) as DiscordChannel
      onSaved(saved, isCreating)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!channel) return
    setBusy(true)
    const res = await fetch(`/api/discord/guild/${guildId}/channels/${channel.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast({ kind: 'err', text: data.error ?? 'Delete failed.' })
      return
    }
    onDeleted(channel.id)
  }

  async function duplicate() {
    if (!channel) return
    setBusy(true)
    const res = await fetch(`/api/discord/guild/${guildId}/channels/${channel.id}/duplicate`, { method: 'POST' })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast({ kind: 'err', text: data.error ?? 'Duplicate failed.' })
      return
    }
    onDuplicated((await res.json()) as DiscordChannel)
  }

  async function saveOverwrite(ow: DiscordPermissionOverwrite): Promise<boolean> {
    if (!channel) return false
    const res = await fetch(
      `/api/discord/guild/${guildId}/channels/${channel.id}/permissions/${ow.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: ow.type, allow: ow.allow, deny: ow.deny }),
      },
    )
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast({ kind: 'err', text: data.error ?? 'Could not save permission.' })
      return false
    }
    setOverwrites((prev) => {
      const existing = prev.findIndex((p) => p.id === ow.id)
      if (existing >= 0) return prev.map((p, i) => (i === existing ? ow : p))
      return [...prev, ow]
    })
    return true
  }

  async function removeOverwrite(overwriteId: string) {
    if (!channel) return
    const res = await fetch(
      `/api/discord/guild/${guildId}/channels/${channel.id}/permissions/${overwriteId}`,
      { method: 'DELETE' },
    )
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast({ kind: 'err', text: data.error ?? 'Could not remove permission.' })
      return
    }
    setOverwrites((prev) => prev.filter((p) => p.id !== overwriteId))
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onClose()}
    >
      <aside
        role="dialog"
        aria-label={isCreating ? `Create ${meta.label.toLowerCase()}` : `Edit ${channel?.name ?? ''}`}
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
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
            >
              {meta.icon}
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-foreground">
                {isCreating ? `Create ${meta.label.toLowerCase()}` : `Edit "${channel?.name ?? ''}"`}
              </h2>
              <p className="truncate text-xs text-subtle">{meta.sub}</p>
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
          {toast && (
            <div
              className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
              style={{
                borderColor: toast.kind === 'ok' ? 'rgba(74,222,128,0.35)' : 'rgba(239,68,68,0.35)',
                background: toast.kind === 'ok' ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)',
                color: toast.kind === 'ok' ? '#4ade80' : '#f87171',
              }}
            >
              {toast.kind === 'ok' ? <Check size={12} className="mt-0.5" /> : <AlertTriangle size={12} className="mt-0.5" />}
              <span>{toast.text}</span>
            </div>
          )}

          {/* Name */}
          <Section icon={meta.icon} label="Name" description="What members see in the channel list.">
            <input
              type="text"
              value={draft.name}
              maxLength={100}
              disabled={busy}
              onChange={(e) => setField('name', e.target.value)}
              placeholder={isCategory ? 'New Category' : 'new-channel'}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
            {!isCategory && !isVoiceLike && (
              <p className="mt-1 text-[11px] text-subtle">
                Discord normalizes text-style channel names to lowercase with dashes.
              </p>
            )}
          </Section>

          {/* Parent category (not for categories themselves) */}
          {!isCategory && (
            <Section icon={<Folder size={13} />} label="Category" description="Move this channel into a category, or leave at the top level.">
              <select
                value={draft.parent_id ?? ''}
                disabled={busy}
                onChange={(e) => setField('parent_id', e.target.value || null)}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              >
                <option value="">No category</option>
                {availableCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Section>
          )}

          {/* Topic */}
          {(isTextLike || isVoiceLike) && (
            <Section icon={<AlignLeft size={13} />} label="Topic" description="Optional. Shown at the top of the channel.">
              <textarea
                value={draft.topic}
                maxLength={1024}
                rows={3}
                disabled={busy}
                onChange={(e) => setField('topic', e.target.value)}
                placeholder="What is this channel about?"
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </Section>
          )}

          {/* NSFW + Slowmode — text-like only */}
          {isTextLike && (
            <Section icon={<EyeOff size={13} />} label="Channel settings" description="Age gating and rate limit.">
              <div
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
                style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
              >
                <div>
                  <p className="text-sm font-medium text-foreground">Age-restricted (NSFW)</p>
                  <p className="text-xs text-subtle">Members must confirm they&apos;re 18+ to view this channel.</p>
                </div>
                {/* Sliding toggle — matches the pattern in App Design,
                    Notification Preferences, and the Roles edit panel. */}
                <button
                  type="button"
                  onClick={() => { if (!busy) setField('nsfw', !draft.nsfw) }}
                  disabled={busy}
                  aria-checked={draft.nsfw}
                  role="switch"
                  className="relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: draft.nsfw ? 'var(--p-1)' : 'var(--line-strong)',
                    cursor: busy ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span
                    className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                    style={{ transform: draft.nsfw ? 'translateX(20px)' : 'translateX(0)' }}
                  />
                </button>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Slow mode</p>
                <select
                  value={draft.rate_limit_per_user}
                  disabled={busy}
                  onChange={(e) => setField('rate_limit_per_user', Number(e.target.value))}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                >
                  {SLOWMODE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-subtle">
                  Minimum time members must wait between sending messages.
                </p>
              </div>
            </Section>
          )}

          {/* Voice settings */}
          {isVoiceLike && (
            <Section icon={<Volume2 size={13} />} label="Voice settings" description="Bitrate and user cap.">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Bitrate</p>
                <select
                  value={draft.bitrate}
                  disabled={busy}
                  onChange={(e) => setField('bitrate', Number(e.target.value))}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                >
                  {BITRATE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-subtle">
                  Higher bitrate sounds better but uses more bandwidth. Boosted servers unlock higher tiers.
                </p>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">User limit</p>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={draft.user_limit}
                  disabled={busy}
                  onChange={(e) => setField('user_limit', Number(e.target.value))}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                />
                <p className="mt-1 text-[11px] text-subtle">
                  0 means no cap. Max 99.
                </p>
              </div>
            </Section>
          )}

          {/* Permission overwrites — only after the channel exists */}
          {!isCreating && channel && (
            <PermissionOverwritesEditor
              channel={channel}
              roles={roles}
              overwrites={overwrites}
              onSave={saveOverwrite}
              onRemove={removeOverwrite}
              disabled={busy}
            />
          )}

          {isCreating && (
            <p className="mt-2 text-xs text-subtle">
              Channel permissions can be edited after the channel is created.
            </p>
          )}
        </div>

        <footer
          className="flex items-center justify-between gap-2 border-t px-5 py-3"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
        >
          <div className="flex items-center gap-2">
            {!isCreating && channel && (
              <>
                <button
                  type="button"
                  onClick={duplicate}
                  disabled={busy || channelType === CHANNEL_TYPES.CATEGORY}
                  title={channelType === CHANNEL_TYPES.CATEGORY ? 'Categories cannot be duplicated.' : 'Create a copy of this channel'}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50"
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
                  style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
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
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
              style={{ background: 'var(--p-1)', color: '#fff' }}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {isCreating ? 'Create' : 'Save changes'}
            </button>
          </div>
        </footer>

        {confirmDelete && channel && (
          <DeleteConfirm
            name={channel.name}
            isCategory={channelType === CHANNEL_TYPES.CATEGORY}
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
  icon, label, description, children,
}: {
  icon: React.ReactNode
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-2)' }}>{label}</h3>
          {description && <p className="text-xs text-subtle">{description}</p>}
        </div>
        <div className="ml-1 h-px flex-1" style={{ background: 'var(--line-strong)' }} />
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function DeleteConfirm({
  name, isCategory, busy, onCancel, onConfirm,
}: {
  name: string
  isCategory: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div className="w-full max-w-sm rounded-xl border p-5 shadow-xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <h3 className="mb-2 font-semibold text-foreground">Delete &ldquo;{name}&rdquo;?</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          {isCategory
            ? 'The category will be removed. Channels inside it stay but become uncategorized.'
            : 'All messages and threads in this channel will be permanently lost. This cannot be undone.'}
        </p>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)' }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
            style={{ background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.5)', color: '#f87171' }}>
            {busy && <Loader2 size={12} className="animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Permission overwrites editor ----------

type OverwriteState = 'allow' | 'deny' | 'neutral'

// Which catalog categories are relevant per channel type. Voice perms make no
// sense on a text channel, etc., so we hide them to keep the panel scannable.
function categoriesForChannelType(type: number): string[] {
  switch (type) {
    case CHANNEL_TYPES.VOICE:
      return ['general', 'voice', 'events']
    case CHANNEL_TYPES.STAGE:
      return ['general', 'voice', 'stage', 'events']
    case CHANNEL_TYPES.CATEGORY:
      return ['general', 'text', 'voice', 'stage', 'events']
    case CHANNEL_TYPES.FORUM:
    case CHANNEL_TYPES.MEDIA:
      return ['general', 'text', 'events']
    default:
      return ['general', 'text', 'events']
  }
}

function getState(ow: DiscordPermissionOverwrite | undefined, bit: bigint): OverwriteState {
  if (!ow) return 'neutral'
  try {
    if ((BigInt(ow.allow) & bit) !== 0n) return 'allow'
    if ((BigInt(ow.deny) & bit) !== 0n) return 'deny'
  } catch { /* fall through */ }
  return 'neutral'
}

function applyState(ow: DiscordPermissionOverwrite, bit: bigint, state: OverwriteState): DiscordPermissionOverwrite {
  let allow = BigInt(ow.allow)
  let deny = BigInt(ow.deny)
  // Clear both first so the bit can move cleanly between buckets.
  allow &= ~bit
  deny &= ~bit
  if (state === 'allow') allow |= bit
  if (state === 'deny') deny |= bit
  return { ...ow, allow: allow.toString(), deny: deny.toString() }
}

function PermissionOverwritesEditor({
  channel, roles, overwrites, onSave, onRemove, disabled,
}: {
  channel: DiscordChannel
  roles: DiscordRole[]
  overwrites: DiscordPermissionOverwrite[]
  onSave: (ow: DiscordPermissionOverwrite) => Promise<boolean>
  onRemove: (overwriteId: string) => Promise<void>
  disabled: boolean
}) {
  const [selectedId, setSelectedId] = useState<string | null>(() => overwrites[0]?.id ?? null)
  const [adding, setAdding] = useState(false)
  const [savingBit, setSavingBit] = useState<string | null>(null)

  const allowedCategoryKeys = useMemo(() => new Set(categoriesForChannelType(channel.type)), [channel.type])
  const filteredCategories = PERMISSION_CATEGORIES.filter((c) => allowedCategoryKeys.has(c.key))

  const sortedRoles = useMemo(
    () => [...roles].sort((a, b) => b.position - a.position),
    [roles],
  )

  const rolesWithoutOverwrite = sortedRoles.filter(
    (r) => !overwrites.some((ow) => ow.id === r.id && ow.type === 0),
  )

  const current = selectedId ? overwrites.find((o) => o.id === selectedId) : undefined
  const currentRole = current?.type === 0 ? roles.find((r) => r.id === current.id) : null

  async function addRoleOverwrite(roleId: string) {
    const ow: DiscordPermissionOverwrite = { id: roleId, type: 0, allow: '0', deny: '0' }
    const ok = await onSave(ow)
    if (ok) {
      setSelectedId(roleId)
      setAdding(false)
    }
  }

  async function toggleBit(perm: PermissionDef, next: OverwriteState) {
    if (!current) return
    const updated = applyState(current, perm.bit, next)
    setSavingBit(perm.key)
    await onSave(updated)
    setSavingBit(null)
  }

  return (
    <Section icon={<Shield size={13} />} label="Permissions" description="Override channel access per role or member.">
      <div className="grid grid-cols-12 gap-3">
        {/* Left rail: list of overwrites */}
        <div
          className="col-span-12 sm:col-span-4 rounded-lg border overflow-hidden"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
        >
          <div className="border-b px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-subtle"
            style={{ borderColor: 'var(--line-strong)' }}>
            Roles / members
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            {overwrites.length === 0 && !adding && (
              <p className="px-3 py-3 text-xs italic text-subtle">No overrides yet. Defaults apply.</p>
            )}
            {overwrites.map((ow) => {
              const role = ow.type === 0 ? roles.find((r) => r.id === ow.id) : null
              const label = role
                ? `@${role.name}`
                : ow.type === 1
                  ? `Member ${ow.id.slice(0, 6)}…`
                  : `Unknown ${ow.id}`
              const dot = role ? roleColor(role.color) : '#999'
              const isSelected = selectedId === ow.id
              return (
                <button
                  key={`${ow.type}-${ow.id}`}
                  type="button"
                  onClick={() => setSelectedId(ow.id)}
                  className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm transition"
                  style={{
                    borderColor: 'var(--line-strong)',
                    background: isSelected ? 'var(--p-soft)' : 'transparent',
                    color: isSelected ? 'var(--p-1)' : 'var(--text)',
                  }}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} />
                  {ow.type === 1 ? <Users size={11} /> : <Shield size={11} />}
                  <span className="truncate">{label}</span>
                </button>
              )
            })}
          </div>
          {adding ? (
            <div className="border-t p-2" style={{ borderColor: 'var(--line-strong)' }}>
              <select
                onChange={(e) => { if (e.target.value) void addRoleOverwrite(e.target.value) }}
                defaultValue=""
                disabled={disabled}
                className="w-full rounded border px-2 py-1.5 text-xs disabled:opacity-50"
                style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              >
                <option value="">Add a role…</option>
                {rolesWithoutOverwrite.map((r) => (
                  <option key={r.id} value={r.id}>@{r.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="mt-1 w-full rounded px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              disabled={disabled || rolesWithoutOverwrite.length === 0}
              className="flex w-full items-center justify-center gap-1 border-t px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-40"
              style={{ borderColor: 'var(--line-strong)' }}
            >
              <Plus size={11} /> Add role overwrite
            </button>
          )}
        </div>

        {/* Right pane: perm grid */}
        <div className="col-span-12 sm:col-span-8">
          {!current ? (
            <div
              className="flex h-full min-h-[200px] items-center justify-center rounded-lg border text-center text-sm text-subtle"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
            >
              <div className="px-6">
                <Lock size={20} className="mx-auto mb-2 opacity-60" />
                Select a role to view or change its channel overrides.
              </div>
            </div>
          ) : (
            <div className="rounded-lg border" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
              <div className="flex items-center justify-between border-b px-3 py-2 text-xs"
                style={{ borderColor: 'var(--line-strong)' }}>
                <span className="font-semibold text-foreground">
                  {currentRole ? `@${currentRole.name}` : current.type === 1 ? 'Member overwrite' : 'Overwrite'}
                </span>
                <button
                  type="button"
                  onClick={() => void onRemove(current.id)}
                  disabled={disabled}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition hover:text-[#f87171] disabled:opacity-40"
                >
                  <Trash2 size={10} /> Reset
                </button>
              </div>
              <div className="max-h-[320px] overflow-y-auto p-2">
                {filteredCategories.map((cat) => (
                  <div key={cat.key} className="mb-3 last:mb-0">
                    <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-subtle">
                      {cat.label}
                    </p>
                    <div className="space-y-1">
                      {cat.permissions.map((p) => {
                        const state = getState(current, p.bit)
                        return (
                          <div
                            key={p.key}
                            className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm"
                            style={{ background: 'var(--panel)' }}
                            title={p.description}
                          >
                            <span className="min-w-0 truncate text-xs text-foreground">{p.label}</span>
                            <div className="inline-flex shrink-0 rounded border p-0.5"
                              style={{ borderColor: 'var(--line-strong)' }}>
                              {(['deny', 'neutral', 'allow'] as const).map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => void toggleBit(p, s)}
                                  disabled={disabled || savingBit === p.key}
                                  className="flex h-5 w-7 items-center justify-center rounded text-[10px] font-semibold transition disabled:opacity-50"
                                  style={{
                                    background: state === s
                                      ? s === 'allow' ? 'rgba(74,222,128,0.18)'
                                        : s === 'deny' ? 'rgba(239,68,68,0.18)'
                                        : 'var(--bg-2)'
                                      : 'transparent',
                                    color: state === s
                                      ? s === 'allow' ? '#4ade80'
                                        : s === 'deny' ? '#f87171'
                                        : 'var(--text-2)'
                                      : 'var(--text-3)',
                                  }}
                                  title={s === 'allow' ? 'Allow' : s === 'deny' ? 'Deny' : 'Inherit'}
                                >
                                  {s === 'allow' ? '✓' : s === 'deny' ? '✗' : '/'}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}
