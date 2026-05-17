'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  NOTIFICATION_TYPES,
  type NotificationCategory,
  type NotificationSeverity,
  type NotificationType,
} from '@/lib/notifications'

export type NotificationRow = {
  id: string
  guild_id: string
  type: NotificationType
  category: NotificationCategory
  severity: NotificationSeverity
  title: string
  body: string | null
  link: string | null
  actor_id: string | null
  /** Server display name — nickname → global name → username. */
  actor_name: string | null
  /** Raw Discord @handle, rendered next to actor_name in the detail view. */
  actor_username: string | null
  target_id: string | null
  target_name: string | null
  metadata: Record<string, unknown>
  created_at: string
  /** Per-user read state, joined server-side. */
  read: boolean
}

export type NotificationPrefs = {
  /** type → enabled. Missing keys default to true. */
  enabled_types: Partial<Record<NotificationType, boolean>>
  toast_enabled: boolean
}

type TransientToast = {
  id: string
  notification: NotificationRow
  /** wall-clock ms when the toast should auto-dismiss. */
  expiresAt: number
}

type ContextValue = {
  notifications: NotificationRow[]
  unreadCount: number
  prefs: NotificationPrefs
  loading: boolean
  /** Live toasts the Toaster component renders. */
  toasts: TransientToast[]
  dismissToast: (id: string) => void
  markRead: (ids: string[]) => Promise<void>
  markAllRead: () => Promise<void>
  markUnread: (ids: string[]) => Promise<void>
  refresh: () => Promise<void>
  savePrefs: (next: NotificationPrefs) => Promise<void>
  /** Pull older notifications for the history page. */
  loadMore: (before: string) => Promise<NotificationRow[]>
}

const NotificationsContext = createContext<ContextValue | null>(null)

const TOAST_TTL_MS = 5_000
const MAX_LIVE_LIST = 50

// Mirrors ChannelsContent: when Discord rate-limits the per-user guilds
// lookup, the API returns this string. Provider backs off and retries instead
// of leaving the bell empty on first page load.
const TRANSIENT_ERROR_HINT = "Couldn't verify your Discord access"
const MAX_TRANSIENT_RETRIES = 15

export function NotificationsProvider({
  guildId,
  children,
}: {
  guildId: string
  children: React.ReactNode
}) {
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [prefs, setPrefs] = useState<NotificationPrefs>({ enabled_types: {}, toast_enabled: true })
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState<TransientToast[]>([])

  // Refs so callbacks (realtime, markRead) can read the latest state
  // synchronously without re-subscribing or running into stale closures.
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const notificationsRef = useRef(notifications)
  notificationsRef.current = notifications
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supabase = useMemo(() => createClient(), [])

  const isTypeEnabled = (type: NotificationType): boolean =>
    prefsRef.current.enabled_types[type] !== false

  // ── Initial fetch ────────────────────────────────────────────────────────
  // Same retry-on-transient-error pattern used by ChannelsContent: when the
  // Discord auth check returns "Couldn't verify your Discord access" we
  // back off and retry instead of silently leaving an empty state.
  const refresh = useCallback(async (attempt = 0): Promise<void> => {
    setLoading(true)
    const [listRes, prefsRes] = await Promise.all([
      fetch(`/api/guilds/${guildId}/notifications?limit=${MAX_LIVE_LIST}`, { cache: 'no-store' }),
      fetch(`/api/guilds/${guildId}/notifications/preferences`, { cache: 'no-store' }),
    ])

    if (!listRes.ok) {
      const data = (await listRes.json().catch(() => ({}))) as { error?: string }
      if (data.error?.includes(TRANSIENT_ERROR_HINT) && attempt < MAX_TRANSIENT_RETRIES) {
        const delay = Math.min(2000, 600 + attempt * 200)
        retryRef.current = setTimeout(() => { refresh(attempt + 1) }, delay)
        return
      }
      console.error('[notifications] fetch failed:', data.error ?? listRes.status)
      setLoading(false)
      return
    }

    const data = (await listRes.json()) as {
      notifications: NotificationRow[]
      unread_count: number
    }
    setNotifications(data.notifications ?? [])
    setUnreadCount(Number(data.unread_count ?? 0))

    if (prefsRes.ok) {
      const prefsData = (await prefsRes.json()) as NotificationPrefs
      setPrefs({
        enabled_types: prefsData.enabled_types ?? {},
        toast_enabled: prefsData.toast_enabled ?? true,
      })
    }
    setLoading(false)
  }, [guildId])

  useEffect(() => {
    refresh()
    return () => { if (retryRef.current) clearTimeout(retryRef.current) }
  }, [refresh])

  // ── Realtime subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!guildId) return
    const channel: RealtimeChannel = supabase
      .channel(`notifications:${guildId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `guild_id=eq.${guildId}`,
        },
        (payload) => {
          const row = payload.new as NotificationRow & { read?: boolean }
          // Server enriches `read`; realtime payloads won't include it, so
          // treat brand-new arrivals as unread for this user.
          const next: NotificationRow = { ...row, read: false }
          setNotifications((prev) => {
            // De-dupe on id in case the initial fetch raced with a realtime
            // event for the same row.
            if (prev.some((n) => n.id === next.id)) return prev
            return [next, ...prev].slice(0, MAX_LIVE_LIST)
          })
          setUnreadCount((c) => c + 1)

          if (prefsRef.current.toast_enabled && isTypeEnabled(next.type)) {
            const toast: TransientToast = {
              id: `${next.id}-${Date.now()}`,
              notification: next,
              expiresAt: Date.now() + TOAST_TTL_MS,
            }
            setToasts((prev) => [...prev.slice(-3), toast])
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [guildId, supabase])

  // ── Toast auto-dismiss ───────────────────────────────────────────────────
  useEffect(() => {
    if (toasts.length === 0) return
    const now = Date.now()
    const nextExpiry = Math.min(...toasts.map((t) => t.expiresAt))
    const wait = Math.max(0, nextExpiry - now)
    const id = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.expiresAt > Date.now()))
    }, wait + 50)
    return () => clearTimeout(id)
  }, [toasts])

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  // ── Read state ───────────────────────────────────────────────────────────
  // Compute the unread delta synchronously from the ref BEFORE calling
  // setNotifications. The previous version mutated a Set from inside the
  // updater and read its size right after — but updaters run asynchronously,
  // so the count was always 0 when checked and the bell badge never moved
  // until the next full refresh.
  const markRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const delta = notificationsRef.current.filter((n) => idSet.has(n.id) && !n.read).length

    setNotifications((prev) => prev.map((n) =>
      idSet.has(n.id) && !n.read ? { ...n, read: true } : n,
    ))
    if (delta > 0) setUnreadCount((c) => Math.max(0, c - delta))

    await fetch(`/api/guilds/${guildId}/notifications/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
  }, [guildId])

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
    await fetch(`/api/guilds/${guildId}/notifications/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
  }, [guildId])

  const markUnread = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const delta = notificationsRef.current.filter((n) => idSet.has(n.id) && n.read).length

    setNotifications((prev) => prev.map((n) =>
      idSet.has(n.id) && n.read ? { ...n, read: false } : n,
    ))
    if (delta > 0) setUnreadCount((c) => c + delta)

    await fetch(`/api/guilds/${guildId}/notifications/read?ids=${ids.join(',')}`, {
      method: 'DELETE',
    })
  }, [guildId])

  // ── Pagination for the history page ──────────────────────────────────────
  const loadMore = useCallback(async (before: string) => {
    const res = await fetch(
      `/api/guilds/${guildId}/notifications?limit=50&before=${encodeURIComponent(before)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return []
    const data = (await res.json()) as { notifications: NotificationRow[] }
    return data.notifications ?? []
  }, [guildId])

  // ── Preferences ──────────────────────────────────────────────────────────
  const savePrefs = useCallback(async (next: NotificationPrefs) => {
    setPrefs(next)
    await fetch(`/api/guilds/${guildId}/notifications/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
  }, [guildId])

  const value: ContextValue = {
    notifications, unreadCount, prefs, loading, toasts,
    dismissToast, markRead, markAllRead, markUnread, refresh, savePrefs, loadMore,
  }

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications(): ContextValue {
  const ctx = useContext(NotificationsContext)
  if (!ctx) {
    throw new Error('useNotifications must be used inside <NotificationsProvider>')
  }
  return ctx
}

/** Default-on per-type check used by the bell + Toaster. */
export function isNotificationTypeEnabled(
  prefs: NotificationPrefs,
  type: NotificationType,
): boolean {
  return prefs.enabled_types[type] !== false
}

/** Re-export so consumers don't have to import from two places. */
export { NOTIFICATION_TYPES }
