'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck, Settings, ArrowRight, AlertCircle } from 'lucide-react'
import { useNotifications, type NotificationRow } from './NotificationsProvider'
import { SEVERITY_BG, SEVERITY_COLOR, formatRelativeTime } from './notification-style'

type Props = { guildId: string }

const PREVIEW_COUNT = 8

/**
 * Bell anchored in the top-right corner, directly below the Discord-link
 * icon. Trigger is a fixed-position square button styled to match the
 * Discord icon; the dropdown opens to its left so it stays on-screen.
 */
export function NotificationBell({ guildId }: Props) {
  const router = useRouter()
  const { notifications, unreadCount, markRead, markAllRead, loading } = useNotifications()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

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

  const preview = notifications.slice(0, PREVIEW_COUNT)

  function handleRowClick(n: NotificationRow) {
    if (!n.read) markRead([n.id])
    setOpen(false)
    if (n.link) router.push(n.link)
  }

  // Sits in the top-right corner's L-bracket elbow — same anchor the Discord
  // icon used to occupy. Icon stays accent-tinted regardless of unread state
  // so it visually matches other accent-coloured affordances in the chrome.
  // z-10 sits in the "chrome" tier (same as CornerDecorations + Discord
  // icon). Lower than this and page content can intercept clicks; higher
  // would beat dialogs. Dialogs use z-[60+] and the :has() rule in
  // globals.css hides the bell entirely while a dialog is open.
  return (
    <div
      ref={rootRef}
      data-pulsify-bell="true"
      className="fixed top-2 right-3 z-10 mt-[40px] mr-[40px]"
    >
      {/* Hover: accent-tinted bg, accent border, slight lift + glow.
          active: snaps back down on press for tactile feedback. */}
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
          // overflow-hidden clips child backgrounds (the footer's bg-2 fill,
          // the rounded scroll list) so the rounded-xl bottom corners look
          // identical to the top instead of square-cut.
          className="absolute right-0 top-full z-40 mt-2 w-[360px] overflow-hidden rounded-xl border shadow-2xl"
          style={{
            background: 'var(--panel)',
            borderColor: 'var(--line-strong)',
          }}
        >
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            <div>
              <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {unreadCount === 0
                  ? 'You’re all caught up.'
                  : `${unreadCount} unread`}
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
                href={`/dashboard/${guildId}/notification-settings`}
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
            {!loading && preview.length === 0 && (
              <li className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <span style={{ color: 'var(--text-3)' }}>
                  <Bell size={26} />
                </span>
                <p className="text-sm font-semibold text-foreground">No notifications yet</p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Server activity will show up here.
                </p>
              </li>
            )}
            {!loading && preview.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => handleRowClick(n)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors"
                  style={{
                    background: n.read ? 'transparent' : 'color-mix(in srgb, var(--p-soft) 60%, transparent)',
                    borderBottom: '1px solid var(--line-strong)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2)' }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = n.read
                      ? 'transparent'
                      : 'color-mix(in srgb, var(--p-soft) 60%, transparent)'
                  }}
                >
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{ background: SEVERITY_BG[n.severity], color: SEVERITY_COLOR[n.severity] }}
                  >
                    <AlertCircle size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm"
                      style={{ color: n.read ? 'var(--text-2)' : 'var(--text)', fontWeight: n.read ? 400 : 600 }}
                    >
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: 'var(--text-3)' }}>
                        {n.body}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                      {formatRelativeTime(n.created_at)} · {n.category}
                    </p>
                  </div>
                  {!n.read && (
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
              href={`/dashboard/${guildId}/notifications`}
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
