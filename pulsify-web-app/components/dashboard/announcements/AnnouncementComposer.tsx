'use client'

import { useMemo, useState } from 'react'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import { useRouter } from 'next/navigation'
import { X, Megaphone, AlertCircle, Loader2, Send, Save, Eye, Hash, CalendarClock } from 'lucide-react'
import Image from 'next/image'
import {
  validateDraft,
  ANNOUNCEMENT_LIMITS,
  isEditable,
  type Announcement,
  type AnnouncementDraft,
} from '@/lib/announcements'
import {
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
} from '@/app/dashboard/[guildId]/announcements/actions'

type Channel = { id: string; name: string }

type Props = {
  guildId: string
  channels: Channel[]
  editing: Announcement | null
  onClose: () => void
  onFeedback: (kind: 'success' | 'error', msg: string) => void
}

const FIELD_CLASS =
  'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-1'
const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}
const errorFieldStyle: React.CSSProperties = { ...fieldStyle, borderColor: 'rgba(239,68,68,0.6)' }

/** ISO ⇄ <input type="datetime-local"> (local time, no seconds). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localInputToIso(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function AnnouncementComposer({ guildId, channels, editing, onClose, onFeedback }: Props) {
  const router = useRouter()
  const isEdit = editing !== null
  const editable = editing ? isEditable(editing) : true

  const [title, setTitle] = useState(editing?.title ?? '')
  const [content, setContent] = useState(editing?.content ?? '')
  const [channelId, setChannelId] = useState(editing?.channel_id ?? channels[0]?.id ?? '')
  const [scheduleOn, setScheduleOn] = useState(Boolean(editing?.scheduled_for))
  const [scheduledLocal, setScheduledLocal] = useState(isoToLocalInput(editing?.scheduled_for ?? null))
  const [saving, setSaving] = useState<null | 'draft' | 'publish'>(null)
  const [error, setError] = useState<string | null>(null)

  useDialogDismiss(onClose, saving !== null)

  const draft: AnnouncementDraft = useMemo(
    () => ({
      title,
      content,
      channel_id: channelId,
      scheduled_for: scheduleOn ? localInputToIso(scheduledLocal) : null,
    }),
    [title, content, channelId, scheduleOn, scheduledLocal],
  )

  const channelName = channels.find((c) => c.id === channelId)?.name

  // Accepts either result shape (create returns `{ data: { id } }`, the others
  // return bare `{ ok }`) — we only branch on ok/error here, so widen the data.
  type AnyResult = { ok: true; data?: unknown } | { ok: false; error: string }

  async function run(fn: () => Promise<AnyResult>, kind: 'draft' | 'publish', successMsg: string) {
    const validationError = validateDraft(draft)
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setSaving(kind)
    const res = await fn()
    setSaving(null)
    if (res.ok) {
      onFeedback('success', successMsg)
      router.refresh()
      onClose()
    } else {
      setError(res.error)
    }
  }

  // Save: create-as-draft, or save edits to an existing draft.
  const onSaveDraft = () =>
    run(
      () => (isEdit ? updateAnnouncement(guildId, editing!.id, draft) : createAnnouncement(guildId, draft, 'draft')),
      'draft',
      isEdit ? 'Draft saved.' : 'Saved as draft.',
    )

  // Publish: create-and-publish, or (when editing) save the edits first then
  // publish the existing row so the latest content goes out.
  const onPublish = () =>
    run(
      async () => {
        if (!isEdit) return createAnnouncement(guildId, draft, 'publish')
        const saved = await updateAnnouncement(guildId, editing!.id, draft)
        if (!saved.ok) return saved
        return publishAnnouncement(guildId, editing!.id)
      },
      'publish',
      'Announcement published to Discord.',
    )

  const titleErr = error && !title.trim()
  const contentErr = error && !content.trim()

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        className="relative flex w-full max-w-3xl max-h-[92vh] flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
              <Megaphone size={20} />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">{isEdit ? 'Edit announcement' : 'New announcement'}</h2>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                {editable ? 'Compose, preview, and publish to a channel.' : 'This announcement has been published.'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5" style={{ color: 'var(--text-3)' }}>
            <X size={18} />
          </button>
        </div>

        <div className="grid flex-1 gap-0 overflow-hidden md:grid-cols-2">
          {/* Form */}
          <div className="flex flex-col gap-4 overflow-y-auto p-5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                Title
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={ANNOUNCEMENT_LIMITS.maxTitle}
                placeholder="What's happening?"
                disabled={!editable}
                className={FIELD_CLASS}
                style={titleErr ? errorFieldStyle : fieldStyle}
              />
              <p className="mt-1 text-right text-[10px]" style={{ color: 'var(--text-3)' }}>
                {title.length}/{ANNOUNCEMENT_LIMITS.maxTitle}
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                Message
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={ANNOUNCEMENT_LIMITS.maxContent}
                rows={8}
                placeholder="Write your announcement… Markdown is supported (**bold**, *italics*, links)."
                disabled={!editable}
                className={`${FIELD_CLASS} resize-y`}
                style={contentErr ? errorFieldStyle : fieldStyle}
              />
              <p className="mt-1 text-right text-[10px]" style={{ color: 'var(--text-3)' }}>
                {content.length}/{ANNOUNCEMENT_LIMITS.maxContent}
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                Channel
              </label>
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                disabled={!editable}
                className={FIELD_CLASS}
                style={fieldStyle}
              >
                {channels.length === 0 && <option value="">No text channels found</option>}
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Optional scheduled time — stored on the draft; publish manually. */}
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line-strong)' }}>
              <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                <input
                  type="checkbox"
                  checked={scheduleOn}
                  onChange={(e) => setScheduleOn(e.target.checked)}
                  disabled={!editable}
                />
                <CalendarClock size={13} /> Set a planned publish time
              </label>
              {scheduleOn && (
                <>
                  <input
                    type="datetime-local"
                    value={scheduledLocal}
                    onChange={(e) => setScheduledLocal(e.target.value)}
                    disabled={!editable}
                    className={`${FIELD_CLASS} mt-2`}
                    style={fieldStyle}
                  />
                  <p className="mt-1.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
                    Marks the draft as scheduled. Auto-publishing isn’t live yet — publish it manually when the time comes.
                  </p>
                </>
              )}
            </div>

            {error && (
              <div
                className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
              >
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Live preview */}
          <div className="flex flex-col overflow-y-auto border-t p-5 md:border-l md:border-t-0" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
            <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
              <Eye size={13} /> Preview
            </p>
            <EmbedPreview title={title} content={content} />
            <p className="mt-3 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
              <Hash size={11} /> Posts to <span style={{ color: 'var(--text-2)' }}>#{channelName ?? '—'}</span>
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t p-4" style={{ borderColor: 'var(--line-strong)' }}>
          <button
            onClick={onClose}
            className="rounded-lg border px-3.5 py-2 text-sm font-medium"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            Cancel
          </button>
          {editable && (
            <button
              onClick={onSaveDraft}
              disabled={saving !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium disabled:opacity-60"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            >
              {saving === 'draft' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {isEdit ? 'Save draft' : 'Save as draft'}
            </button>
          )}
          {editable && (
            <button
              onClick={onPublish}
              disabled={saving !== null}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
            >
              {saving === 'publish' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              Publish now
            </button>
          )}
        </div>
      </aside>
    </div>
  )
}

/**
 * A faithful-enough preview of the Pulse announcement embed: the violet accent
 * bar, the `Pulse` label + title beside the announcement badge, the message
 * body, and the footer — mirroring announcementContainer() in actions.ts.
 */
function EmbedPreview({ title, content }: { title: string; content: string }) {
  const dateLabel = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{ background: 'var(--panel)', borderLeft: '4px solid #8b5cf6', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
    >
      <div className="flex items-start gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold" style={{ color: 'var(--text-2)' }}>
            Pulse
          </p>
          <p className="mt-0.5 break-words text-lg font-bold leading-snug text-foreground">
            {title.trim() || 'Announcement title'}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            Announcement · {dateLabel}
          </p>
          <div className="mt-2.5 whitespace-pre-wrap break-words text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {content.trim() || 'Your message will appear here…'}
          </div>
          <div className="mt-3 border-t pt-2 text-[11px]" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
            Pulse · Announcement
          </div>
        </div>
        <Image src="/pulse-annoucement.png" alt="" width={40} height={40} className="shrink-0 rounded-md" />
      </div>
    </div>
  )
}
