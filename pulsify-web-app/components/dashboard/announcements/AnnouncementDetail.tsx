'use client'

import { useEffect, useState } from 'react'
import {
  X, Megaphone, Hash, Clock, Pencil, Send, Copy, CopyPlus, Trash2, ExternalLink, AlertTriangle, User,
} from 'lucide-react'
import {
  STATUS_META,
  displayState,
  isEditable,
  type Announcement,
} from '@/lib/announcements'
import {
  publishAnnouncement,
  duplicateAnnouncement,
  deleteAnnouncement,
  type ActionResult,
} from '@/app/dashboard/[guildId]/announcements/actions'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { StatusIcon } from './icons'

type Props = {
  guildId: string
  announcement: Announcement
  channelName?: string
  onEdit: () => void
  onClose: () => void
  runAction: <T>(fn: () => Promise<ActionResult<T>>, successMsg?: string) => Promise<ActionResult<T>>
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export function AnnouncementDetail({ guildId, announcement, channelName, onEdit, onClose, runAction }: Props) {
  const state = displayState(announcement)
  const meta = STATUS_META[state]
  const editable = isEditable(announcement)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    document.body.classList.add('slide-over-open')
    return () => document.body.classList.remove('slide-over-open')
  }, [])

  const messageLink =
    announcement.status === 'published' && announcement.message_id
      ? `https://discord.com/channels/${guildId}/${announcement.channel_id}/${announcement.message_id}`
      : null

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(announcement.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  async function doPublish() {
    setBusy(true)
    await runAction(
      () => publishAnnouncement(guildId, announcement.id),
      announcement.status === 'failed' ? 'Announcement re-sent to Discord.' : 'Announcement published to Discord.',
    )
    setBusy(false)
  }

  async function doDuplicate() {
    setBusy(true)
    const res = await runAction(() => duplicateAnnouncement(guildId, announcement.id), 'Duplicated as a new draft.')
    setBusy(false)
    if (res.ok) onClose()
  }

  async function doDelete() {
    setBusy(true)
    const res = await runAction(() => deleteAnnouncement(guildId, announcement.id), 'Announcement deleted.')
    setBusy(false)
    setConfirmDelete(false)
    if (res.ok) onClose()
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <aside
          role="dialog"
          aria-modal="true"
          className="relative flex w-full max-w-lg max-h-[90vh] flex-col overflow-hidden rounded-2xl border shadow-2xl"
          style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                <Megaphone size={20} />
              </div>
              <div className="min-w-0">
                <h2 className="truncate font-semibold text-foreground">{announcement.title}</h2>
                <span
                  className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ color: meta.color, background: `${meta.color}1f` }}
                >
                  <StatusIcon name={meta.icon} size={11} />
                  {meta.label}
                </span>
              </div>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5" style={{ color: 'var(--text-3)' }}>
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {/* Content */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                  Message
                </p>
                <button onClick={copyContent} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--p-1)' }}>
                  <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="whitespace-pre-wrap rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
                {announcement.content}
              </p>
            </div>

            {/* Facts */}
            <div className="grid grid-cols-2 gap-2.5">
              <Fact icon={<Hash size={14} />} label="Channel" value={`#${channelName ?? announcement.channel_id}`} />
              <Fact icon={<User size={14} />} label="Author" value={announcement.author_name ?? '—'} />
              <Fact icon={<Clock size={14} />} label="Created" value={fmt(announcement.created_at)} />
              <Fact
                icon={<Send size={14} />}
                label={state === 'scheduled' ? 'Scheduled for' : 'Published'}
                value={state === 'scheduled' ? fmt(announcement.scheduled_for) : fmt(announcement.published_at)}
              />
            </div>

            {state === 'failed' && announcement.error && (
              <div className="flex items-start gap-2 rounded-xl border p-3 text-sm" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>{announcement.error}</span>
              </div>
            )}

            {messageLink && (
              <a
                href={messageLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium"
                style={{ color: 'var(--p-1)' }}
              >
                <ExternalLink size={14} /> View in Discord
              </a>
            )}
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2 border-t p-4" style={{ borderColor: 'var(--line-strong)' }}>
            {editable && <ActionBtn onClick={onEdit} icon={<Pencil size={14} />} label="Edit" disabled={busy} />}
            {editable && (
              <ActionBtn
                onClick={doPublish}
                icon={<Send size={14} />}
                label={announcement.status === 'failed' ? 'Retry' : 'Publish'}
                accent
                disabled={busy}
              />
            )}
            <ActionBtn onClick={doDuplicate} icon={<CopyPlus size={14} />} label="Duplicate" disabled={busy} />
            <ActionBtn onClick={() => setConfirmDelete(true)} icon={<Trash2 size={14} />} label="Delete" danger disabled={busy} />
          </div>
        </aside>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete announcement?"
          description={
            announcement.status === 'published'
              ? 'This removes the announcement and deletes its message from Discord. This can’t be undone.'
              : 'This permanently removes the draft. This can’t be undone.'
          }
          confirmLabel="Delete"
          tone="destructive"
          busy={busy}
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-2.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
        {icon}
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

function ActionBtn({
  onClick,
  icon,
  label,
  accent,
  danger,
  disabled,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  accent?: boolean
  danger?: boolean
  disabled?: boolean
}) {
  const style = accent
    ? { background: 'linear-gradient(135deg, var(--p-1), var(--p-2))', color: '#fff', border: 'none' }
    : danger
      ? { borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }
      : { borderColor: 'var(--line-strong)', color: 'var(--text-2)' }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60"
      style={style}
    >
      {icon}
      {label}
    </button>
  )
}
