'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  X,
  Loader2,
  Trash2,
  AlertTriangle,
  Check,
  Save,
  CalendarPlus,
  Tag,
  AlignLeft,
  MapPin,
  Calendar,
  Image as ImageIcon,
  Eye,
  Mic2,
  Volume2,
  Globe,
} from 'lucide-react'
import type { DiscordScheduledEvent, DiscordChannel } from '@/lib/discord'

export type EventDraft = {
  name: string
  description: string
  entity_type: 1 | 2 | 3
  channel_id: string | null
  location: string
  start: string  // datetime-local value
  end: string    // datetime-local value (optional except for external)
  /** Cover image as a data URI ("data:image/png;base64,…") if newly uploaded. */
  imageDataUri: string | null
  /** True if the user explicitly cleared an existing cover. */
  imageCleared: boolean
}

type Props = {
  guildId: string
  event: DiscordScheduledEvent | null
  isCreating: boolean
  channels: DiscordChannel[]
  onClose: () => void
  onSaved: (event: DiscordScheduledEvent, isNew: boolean) => void
  onDeleted: (eventId: string) => void
}

const ENTITY_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Stage Channel',
  2: 'Voice Channel',
  3: 'External Location',
}

// Discord channel type IDs we care about per event entity.
//  - Stage events (1) require a stage channel (13)
//  - Voice events (2) require a voice channel (2)
const CHANNEL_TYPE_FOR_ENTITY: Record<1 | 2, number> = { 1: 13, 2: 2 }

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  // datetime-local input wants "YYYY-MM-DDTHH:mm" in local time.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function emptyDraft(): EventDraft {
  // Default to "an hour from now" so the date input isn't already in the past.
  const start = new Date(Date.now() + 60 * 60_000)
  return {
    name: '',
    description: '',
    entity_type: 2,
    channel_id: null,
    location: '',
    start: toLocalInput(start.toISOString()),
    end: '',
    imageDataUri: null,
    imageCleared: false,
  }
}

function draftFromEvent(e: DiscordScheduledEvent): EventDraft {
  return {
    name: e.name,
    description: e.description ?? '',
    entity_type: e.entity_type,
    // channel_id isn't included in the catalog DiscordScheduledEvent type but
    // is in the API response — cast through unknown to access it safely.
    channel_id: (e as unknown as { channel_id: string | null }).channel_id ?? null,
    location: e.entity_metadata?.location ?? '',
    start: toLocalInput(e.scheduled_start_time),
    end: toLocalInput(e.scheduled_end_time),
    imageDataUri: null,
    imageCleared: false,
  }
}

export function EventEditor({
  guildId, event, isCreating, channels, onClose, onSaved, onDeleted,
}: Props) {
  const [draft, setDraft] = useState<EventDraft>(() =>
    event ? draftFromEvent(event) : emptyDraft(),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    setDraft(event ? draftFromEvent(event) : emptyDraft())
    setError(null)
    setSuccess(null)
    setConfirmDelete(false)
    setShowPreview(false)
  }, [event?.id, isCreating])

  useEffect(() => {
    document.body.classList.add('slide-over-open')
    return () => document.body.classList.remove('slide-over-open')
  }, [])

  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => setSuccess(null), 3000)
    return () => clearTimeout(t)
  }, [success])

  // For Voice/Stage events, only show channels of the matching type.
  const eligibleChannels = useMemo(() => {
    if (draft.entity_type === 3) return []
    const wanted = CHANNEL_TYPE_FOR_ENTITY[draft.entity_type]
    return channels.filter((c) => c.type === wanted)
  }, [channels, draft.entity_type])

  // The endpoint also requires the event status to remain SCHEDULED (1) when
  // editing — non-status fields can't be PATCHed once an event is active.
  const canEdit = !event || event.status === 1
  const readOnlyNotice = event && event.status !== 1
    ? "This event has already started or finished — Discord won't accept further edits."
    : null

  function setField<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function handleEntityChange(next: 1 | 2 | 3) {
    setDraft((prev) => ({
      ...prev,
      entity_type: next,
      channel_id: next === 3 ? null : prev.channel_id,
      // External events require an end time — pre-fill 1h after start if blank.
      end: next === 3 && !prev.end
        ? toLocalInput(new Date(new Date(prev.start).getTime() + 60 * 60_000).toISOString())
        : prev.end,
    }))
  }

  async function handleImageFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setError('Cover image must be under 10MB.')
      return
    }
    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    setDraft((d) => ({ ...d, imageDataUri: dataUri, imageCleared: false }))
  }

  function clearImage() {
    setDraft((d) => ({ ...d, imageDataUri: null, imageCleared: true }))
  }

  function validate(): string | null {
    if (!draft.name.trim()) return 'Name is required.'
    if (!draft.start) return 'Start time is required.'
    if (draft.entity_type === 3) {
      if (!draft.location.trim()) return 'Location is required for external events.'
      if (!draft.end) return 'End time is required for external events.'
    } else {
      if (!draft.channel_id) return 'Pick a channel for this event.'
    }
    if (draft.end && new Date(draft.end) <= new Date(draft.start)) {
      return 'End time must be after start time.'
    }
    return null
  }

  async function save() {
    const validation = validate()
    if (validation) { setError(validation); return }
    setBusy(true)
    setError(null)
    setSuccess(null)

    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      entity_type: draft.entity_type,
      scheduled_start_time: toIso(draft.start),
    }
    if (draft.entity_type === 3) {
      body.location = draft.location.trim()
      body.scheduled_end_time = toIso(draft.end)
      body.channel_id = null
    } else {
      body.channel_id = draft.channel_id
      body.scheduled_end_time = draft.end ? toIso(draft.end) : null
    }
    if (draft.imageDataUri) body.image = draft.imageDataUri
    else if (draft.imageCleared) body.image = null

    try {
      const res = isCreating
        ? await fetch(`/api/discord/guild/${guildId}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch(`/api/discord/guild/${guildId}/events/${event!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? `Discord rejected the change (${res.status}).`)
        return
      }
      onSaved((await res.json()) as DiscordScheduledEvent, isCreating)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!event) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/discord/guild/${guildId}/events/${event.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Delete failed.')
      return
    }
    onDeleted(event.id)
  }

  async function cancelEvent() {
    if (!event) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/discord/guild/${guildId}/events/${event.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 4 }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Could not cancel event.')
      return
    }
    onSaved((await res.json()) as DiscordScheduledEvent, false)
  }

  const coverImageSrc = draft.imageDataUri
    ?? (event && !draft.imageCleared && event.image
      ? `https://cdn.discordapp.com/guild-events/${event.id}/${event.image}.png?size=1024`
      : null)

  return (
    <>
      <div className="fixed inset-0 z-[60]" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => !busy && onClose()} />
      <aside
        role="dialog"
        aria-label={isCreating ? 'Create event' : `Edit event ${event?.name ?? ''}`}
        className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[656px] flex-col border-l shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <header className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
            >
              <CalendarPlus size={15} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-foreground">
                {isCreating ? 'Create event' : `Edit "${event?.name ?? ''}"`}
              </h2>
              {readOnlyNotice && (
                <p className="text-xs text-subtle">{readOnlyNotice}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowPreview((s) => !s)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition hover:bg-[var(--bg-2)] disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              title={showPreview ? 'Hide preview' : 'Show preview'}
            >
              <Eye size={12} />
              {showPreview ? 'Hide preview' : 'Preview'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          )}
          {success && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: 'rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.08)', color: '#4ade80' }}>
              <Check size={12} className="mt-0.5 shrink-0" /><span>{success}</span>
            </div>
          )}

          {showPreview ? (
            <EventPreview draft={draft} channels={channels} coverImageSrc={coverImageSrc} />
          ) : (
            <>
              {/* Type selector */}
              <Section icon={<Tag size={13} />} label="Event type" description="Where the event happens.">
                <div className="grid grid-cols-3 gap-2">
                  {([1, 2, 3] as const).map((t) => {
                    const active = draft.entity_type === t
                    const Icon = t === 1 ? Mic2 : t === 2 ? Volume2 : Globe
                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={!canEdit || busy || (!isCreating && t !== draft.entity_type)}
                        onClick={() => handleEntityChange(t)}
                        className="flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium transition disabled:opacity-50"
                        style={{
                          background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                          borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                          color: active ? 'var(--p-1)' : 'var(--text-2)',
                        }}
                        title={!isCreating && t !== draft.entity_type ? 'Event type cannot change after creation' : ENTITY_LABELS[t]}
                      >
                        <Icon size={14} />
                        {ENTITY_LABELS[t]}
                      </button>
                    )
                  })}
                </div>
              </Section>

              {/* Name */}
              <Section icon={<Tag size={13} />} label="Name" description="Shown at the top of the event card.">
                <input
                  type="text"
                  value={draft.name}
                  maxLength={100}
                  disabled={!canEdit || busy}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="Friday game night"
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                />
              </Section>

              {/* Description */}
              <Section icon={<AlignLeft size={13} />} label="Description" description="Optional context shown on the event detail.">
                <textarea
                  value={draft.description}
                  maxLength={1000}
                  rows={3}
                  disabled={!canEdit || busy}
                  onChange={(e) => setField('description', e.target.value)}
                  placeholder="What's happening, who should join, what to bring…"
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                />
              </Section>

              {/* Channel / Location */}
              {draft.entity_type === 3 ? (
                <Section icon={<MapPin size={13} />} label="Location" description="Where to meet — URL, address, or venue name.">
                  <input
                    type="text"
                    value={draft.location}
                    maxLength={100}
                    disabled={!canEdit || busy}
                    onChange={(e) => setField('location', e.target.value)}
                    placeholder="https://meet.example.com/abc-defg"
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
                    style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                  />
                </Section>
              ) : (
                <Section
                  icon={draft.entity_type === 1 ? <Mic2 size={13} /> : <Volume2 size={13} />}
                  label="Channel"
                  description={`Pick a ${draft.entity_type === 1 ? 'stage' : 'voice'} channel.`}
                >
                  <select
                    value={draft.channel_id ?? ''}
                    disabled={!canEdit || busy}
                    onChange={(e) => setField('channel_id', e.target.value || null)}
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
                    style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                  >
                    <option value="">Select a channel…</option>
                    {eligibleChannels.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {eligibleChannels.length === 0 && (
                    <p className="mt-1 text-[11px] text-subtle">
                      No matching channels on this server.
                    </p>
                  )}
                </Section>
              )}

              {/* Start / End */}
              <Section icon={<Calendar size={13} />} label="Schedule" description="Event start and (optional) end time, in your local timezone.">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-medium text-muted-foreground">
                    Start
                    <input
                      type="datetime-local"
                      value={draft.start}
                      disabled={!canEdit || busy}
                      onChange={(e) => setField('start', e.target.value)}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
                      style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                    />
                  </label>
                  <label className="text-xs font-medium text-muted-foreground">
                    End {draft.entity_type === 3 && <span className="text-[#f87171]">*</span>}
                    <input
                      type="datetime-local"
                      value={draft.end}
                      disabled={!canEdit || busy}
                      onChange={(e) => setField('end', e.target.value)}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
                      style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                    />
                  </label>
                </div>
              </Section>

              {/* Cover image */}
              <Section icon={<ImageIcon size={13} />} label="Cover image" description="Optional. PNG/JPG, up to 10 MB.">
                <div className="flex items-start gap-3">
                  <div
                    className="h-20 w-32 shrink-0 overflow-hidden rounded-lg border"
                    style={{
                      borderColor: 'var(--line-strong)',
                      background: 'var(--bg-2)',
                      backgroundImage: coverImageSrc ? `url(${coverImageSrc})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  >
                    {!coverImageSrc && (
                      <div className="flex h-full w-full items-center justify-center text-subtle">
                        <ImageIcon size={16} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:bg-[var(--bg-2)]"
                      style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                    >
                      <ImageIcon size={12} />
                      Upload image
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/gif"
                        className="hidden"
                        disabled={!canEdit || busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) void handleImageFile(f)
                          e.target.value = ''
                        }}
                      />
                    </label>
                    {coverImageSrc && (
                      <button
                        type="button"
                        onClick={clearImage}
                        disabled={!canEdit || busy}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50"
                        style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
                      >
                        <Trash2 size={12} />
                        Remove cover
                      </button>
                    )}
                  </div>
                </div>
              </Section>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          <div className="flex items-center gap-2">
            {!isCreating && event && (
              <>
                {event.status === 1 && (
                  <button
                    type="button"
                    onClick={cancelEvent}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50"
                    style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                  >
                    Cancel event
                  </button>
                )}
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
              disabled={!canEdit || busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
              style={{ background: 'var(--p-1)', color: '#fff' }}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {isCreating ? 'Create event' : 'Save changes'}
            </button>
          </div>
        </footer>

        {confirmDelete && event && (
          <DeleteConfirm name={event.name} busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={remove} />
        )}
      </aside>
    </>
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

function EventPreview({
  draft, channels, coverImageSrc,
}: {
  draft: EventDraft
  channels: DiscordChannel[]
  coverImageSrc: string | null
}) {
  const channelName = channels.find((c) => c.id === draft.channel_id)?.name
  const where = draft.entity_type === 3 ? draft.location : channelName ? `#${channelName}` : '—'
  const startDate = draft.start ? new Date(draft.start) : null
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
      {coverImageSrc && (
        <div
          className="aspect-[16/7] w-full"
          style={{ backgroundImage: `url(${coverImageSrc})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
      )}
      <div className="p-5" style={{ background: 'var(--panel)' }}>
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--p-1)' }}>
          {startDate ? startDate.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' }) : 'No start time'}
        </p>
        <h3 className="mt-1 text-lg font-bold text-foreground">{draft.name || 'Untitled event'}</h3>
        {draft.description && (
          <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{draft.description}</p>
        )}
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-subtle">
          {draft.entity_type === 1 && <Mic2 size={11} />}
          {draft.entity_type === 2 && <Volume2 size={11} />}
          {draft.entity_type === 3 && <Globe size={11} />}
          {where}
        </p>
      </div>
    </div>
  )
}

function DeleteConfirm({
  name, busy, onCancel, onConfirm,
}: {
  name: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div className="w-full max-w-sm rounded-xl border p-5 shadow-xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <h3 className="mb-2 font-semibold text-foreground">Delete "{name}"?</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          This permanently removes the event from Discord. Members who marked it as interesting will no longer see it.
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
            Delete event
          </button>
        </div>
      </div>
    </div>
  )
}
