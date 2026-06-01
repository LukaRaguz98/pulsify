'use client'

import { Megaphone, Hash, Clock } from 'lucide-react'
import {
  STATUS_META,
  displayState,
  contentPreview,
  type Announcement,
} from '@/lib/announcements'
import { StatusIcon } from './icons'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function AnnouncementCard({
  announcement,
  channelName,
  onSelect,
}: {
  announcement: Announcement
  channelName?: string
  onSelect: () => void
}) {
  const state = displayState(announcement)
  const meta = STATUS_META[state]

  // Right-hand timestamp depends on the state: when it went out, or when it's
  // planned, otherwise when it was last touched.
  const stamp =
    state === 'published' && announcement.published_at
      ? `Published ${timeAgo(announcement.published_at)}`
      : state === 'scheduled' && announcement.scheduled_for
        ? `For ${new Date(announcement.scheduled_for).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
        : `Edited ${timeAgo(announcement.updated_at)}`

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex flex-col rounded-2xl border p-4 text-left transition-all"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--p-1)'
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--line-strong)'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      {/* Header: status pill + channel */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ color: meta.color, background: `${meta.color}1f` }}
        >
          <StatusIcon name={meta.icon} size={12} />
          {meta.label}
        </span>
        <span className="inline-flex items-center gap-1 truncate text-xs" style={{ color: 'var(--text-3)' }}>
          <Hash size={12} />
          {channelName ?? announcement.channel_id}
        </span>
      </div>

      {/* Title + content preview */}
      <div className="flex items-start gap-2.5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
        >
          <Megaphone size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">{announcement.title}</p>
          <p className="line-clamp-2 text-sm" style={{ color: 'var(--text-2)' }}>
            {contentPreview(announcement.content, 120)}
          </p>
        </div>
      </div>

      {/* Footer: timestamp + author */}
      <div
        className="mt-3 flex items-center justify-between gap-2 border-t pt-3 text-xs"
        style={{ borderColor: 'var(--line-strong)' }}
      >
        <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
          <Clock size={12} />
          {stamp}
        </span>
        {announcement.author_name && (
          <span className="truncate" style={{ color: 'var(--text-3)' }}>
            {announcement.author_name}
          </span>
        )}
      </div>

      {state === 'failed' && announcement.error && (
        <p className="mt-2 truncate text-[11px]" style={{ color: '#f87171' }} title={announcement.error}>
          {announcement.error}
        </p>
      )}
    </button>
  )
}
