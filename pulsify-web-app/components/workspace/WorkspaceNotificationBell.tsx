'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck, Settings, ArrowRight, AlertCircle } from 'lucide-react'
import { ACTIVITY_CATEGORY_ACCENT, ACTIVITY_CATEGORY_LABELS, timeAgo } from '@/lib/workspace'
import type { WorkspaceFeedItem } from '@/app/api/workspace/[workspaceId]/feed/route'

type Props = { workspaceId: string }

const PREVIEW_COUNT = 8

/**
 * Top-right bell for the workspace area, mirroring the server dashboard's
 * NotificationBell. Reads + mark-all-read use the same shape (POST /read with
 * ids[] or all=true), so the UI patterns translate 1:1 — only the data source
 * differs (synthesised workspace feed vs the notifications table).
 */
export function WorkspaceNotificationBell({ workspaceId }: Props) {
  const router = useRouter()
  const [items, setItems] = useState<WorkspaceFeedItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/feed?limit=${PREVIEW_COUNT}`, { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as { items: WorkspaceFeedItem[]; unread_count: number }
        setItems(data.items ?? [])
        setUnreadCount(Number(data.unread_count ?? 0))
      }
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { refresh() }, [refresh])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Mark a single item read locally + on the server, then decrement the badge.
  // We optimistically flip the local state so the unread highlight clears
  // immediately on click without waiting for the round-trip.
  const markRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const delta = items.filter((i) => idSet.has(i.id) && !i.read).length
    if (delta === 0) return
    setItems((prev) => prev.map((i) => (idSet.has(i.id) && !i.read ? { ...i, read: true } : i)))
    setUnreadCount((c) => Math.max(0, c - delta))
    await fetch(`/api/workspace/${workspaceId}/notifications/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
  }, [items, workspaceId])

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((i) => ({ ...i, read: true })))
    setUnreadCount(0)
    await fetch(`/api/workspace/${workspaceId}/notifications/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
  }, [workspaceId])

  function handleRowClick(it: WorkspaceFeedItem) {
    if (!it.read) markRead([it.id])
    setOpen(false)
    const sub =
      it.category === 'moderation' || it.category === 'warnings' || it.category === 'watchlist' || it.category === 'tickets'
        ? 'moderation'
        : it.category === 'team'
          ? 'team'
          : it.category === 'notes'
            ? 'notes'
            : it.category === 'tasks'
              ? 'tasks'
              : it.category === 'incidents'
                ? 'incidents'
                : it.category === 'servers'
                  ? 'servers'
                  : 'notifications'
    router.push(`/workspace/${workspaceId}/${sub}`)
  }

  return (
    <div
      ref={rootRef}
      data-pulsify-bell="true"
      className="fixed top-2 right-3 z-10 mt-[40px] mr-[40px]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-label="Open notifications"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-md border bg-[var(--panel)] border-[var(--line-strong)] text-[var(--p-1)] transition-all duration-150 hover:bg-[var(--p-soft)] hover:border-[var(--p-1)] hover:-translate-y-0.5 hover:shadow-[0_4px_12px_-4px_var(--p-glow)] active:translate-y-0 active:shadow-none"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
            style={{
              background: 'linear-gradient(135deg, var(--p-1), var(--p-2))',
              boxShadow: '0 0 0 2px var(--bg)',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-40 mt-2 w-[360px] overflow-hidden rounded-xl border shadow-2xl"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            <div>
              <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {unreadCount === 0 ? 'You’re all caught up.' : `${unreadCount} unread`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => markAllRead()}
                  title="Mark all as read"
                  className="rounded-md p-1.5 transition"
                  style={{ color: 'var(--text-3)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
                >
                  <CheckCheck size={14} />
                </button>
              )}
              <Link
                href={`/workspace/${workspaceId}/notification-settings`}
                onClick={() => setOpen(false)}
                title="Notification preferences"
                className="rounded-md p-1.5 transition"
                style={{ color: 'var(--text-3)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
              >
                <Settings size={14} />
              </Link>
            </div>
          </div>

          <ul className="max-h-[420px] overflow-y-auto">
            {loading && (
              <li className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                Loading…
              </li>
            )}
            {!loading && items.length === 0 && (
              <li className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <span style={{ color: 'var(--text-3)' }}>
                  <Bell size={26} />
                </span>
                <p className="text-sm font-semibold text-foreground">No notifications yet</p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Workspace activity will show up here.
                </p>
              </li>
            )}
            {!loading && items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => handleRowClick(it)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors"
                  style={{
                    background: it.read ? 'transparent' : 'color-mix(in srgb, var(--p-soft) 60%, transparent)',
                    borderBottom: '1px solid var(--line-strong)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2)' }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = it.read
                      ? 'transparent'
                      : 'color-mix(in srgb, var(--p-soft) 60%, transparent)'
                  }}
                >
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: `${ACTIVITY_CATEGORY_ACCENT[it.category]}1f`,
                      color: ACTIVITY_CATEGORY_ACCENT[it.category],
                    }}
                  >
                    <AlertCircle size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm"
                      style={{ color: it.read ? 'var(--text-2)' : 'var(--text)', fontWeight: it.read ? 400 : 600 }}
                    >
                      {it.summary}
                    </p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                      {timeAgo(it.ts)} · {ACTIVITY_CATEGORY_LABELS[it.category]}
                      {it.guildName ? ` · ${it.guildName}` : ''}
                    </p>
                  </div>
                  {!it.read && (
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: 'var(--p-1)' }}
                      aria-label="Unread"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>

          <div
            className="border-t px-4 py-3"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
          >
            <Link
              href={`/workspace/${workspaceId}/notifications`}
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ color: 'var(--p-1)' }}
            >
              View all notifications
              <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
