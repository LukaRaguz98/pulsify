'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Bell, AlertCircle, Filter, Loader2, RefreshCw, Settings, CheckCheck, Trash2,
  CircleSlash, MailOpen,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_ACCENT,
  ACTIVITY_CATEGORY_LABELS,
  timeAgo,
  type ActivityCategory,
} from '@/lib/workspace'
import type { WorkspaceFeedItem } from '@/app/api/workspace/[workspaceId]/feed/route'

type Props = { workspaceId: string }

// First page = 25; "Load older" reveals/fetches the next batch of this size.
const PAGE_SIZE = 25

/**
 * Full notifications history for a workspace. Mirrors the server dashboard's
 * NotificationsContent — page header with Refresh + Mark all read + Clear all
 * + Settings, category filter chips + "Unread only" toggle, per-row read /
 * unread toggle. Items paginate by 25 via "Load older".
 */
export function WorkspaceNotificationsContent({ workspaceId }: Props) {
  const [items, setItems] = useState<WorkspaceFeedItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reachedEnd, setReachedEnd] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [filter, setFilter] = useState<'all' | ActivityCategory>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setReachedEnd(false)
    setVisibleCount(PAGE_SIZE)
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/feed?limit=${PAGE_SIZE}`, { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as { items: WorkspaceFeedItem[]; unread_count: number }
        setItems(data.items ?? [])
        setUnreadCount(Number(data.unread_count ?? 0))
        if ((data.items ?? []).length < PAGE_SIZE) setReachedEnd(true)
      }
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { refresh() }, [refresh])

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

  const markUnread = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const delta = items.filter((i) => idSet.has(i.id) && i.read).length
    setItems((prev) => prev.map((i) => (idSet.has(i.id) && i.read ? { ...i, read: false } : i)))
    if (delta > 0) setUnreadCount((c) => c + delta)
    await fetch(`/api/workspace/${workspaceId}/notifications/read?ids=${ids.join(',')}`, {
      method: 'DELETE',
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

  async function handleClearAll() {
    setClearing(true)
    const res = await fetch(`/api/workspace/${workspaceId}/feed`, { method: 'DELETE' })
    setClearing(false)
    setClearOpen(false)
    if (res.ok) {
      setItems([])
      setUnreadCount(0)
      setReachedEnd(true)
      setVisibleCount(PAGE_SIZE)
      await refresh()
    }
  }

  const filtered = useMemo(() => items.filter((i) => {
    if (filter !== 'all' && i.category !== filter) return false
    if (unreadOnly && i.read) return false
    return true
  }), [items, filter, unreadOnly])

  const displayed = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])

  const presentCategories = useMemo(() => {
    const set = new Set<ActivityCategory>()
    for (const i of items) set.add(i.category)
    return ACTIVITY_CATEGORIES.filter((c) => set.has(c))
  }, [items])

  function selectFilter(next: 'all' | ActivityCategory) {
    setFilter(next)
    setVisibleCount(PAGE_SIZE)
  }

  function toggleUnreadOnly() {
    setUnreadOnly((u) => !u)
    setVisibleCount(PAGE_SIZE)
  }

  async function handleLoadMore() {
    if (loadingMore) return
    const nextCount = visibleCount + PAGE_SIZE
    if (filtered.length < nextCount && !reachedEnd) {
      const oldest = items[items.length - 1]
      if (!oldest) { setReachedEnd(true); return }
      setLoadingMore(true)
      try {
        const res = await fetch(
          `/api/workspace/${workspaceId}/feed?limit=${PAGE_SIZE}&before=${encodeURIComponent(oldest.ts)}`,
          { cache: 'no-store' },
        )
        if (!res.ok) { setReachedEnd(true); return }
        const data = (await res.json()) as { items: WorkspaceFeedItem[] }
        const more = data.items ?? []
        if (more.length === 0) setReachedEnd(true)
        else setItems((prev) => [...prev, ...more])
        if (more.length < PAGE_SIZE) setReachedEnd(true)
      } finally {
        setLoadingMore(false)
      }
    }
    setVisibleCount(nextCount)
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Notifications"
        helpId="workspace-notifications"
        description="Activity feed across this workspace and its servers. Latest first."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              >
                <CheckCheck size={12} />
                Mark all read
              </button>
            )}
            <button
              type="button"
              onClick={() => setClearOpen(true)}
              disabled={items.length === 0}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
              style={{
                borderColor: 'rgba(239,68,68,0.35)',
                background: 'rgba(239,68,68,0.06)',
                color: '#f87171',
              }}
            >
              <Trash2 size={12} />
              Clear all
            </button>
            <Link
              href={`/workspace/${workspaceId}/notification-settings`}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <Settings size={12} />
              Settings
            </Link>
          </div>
        }
      />

      {/* Filters */}
      {presentCategories.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
            <Filter size={11} /> Filter
          </span>
          <FilterChip label="All" active={filter === 'all'} color="var(--p-1)" onClick={() => selectFilter('all')} />
          {presentCategories.map((c) => (
            <FilterChip
              key={c}
              label={ACTIVITY_CATEGORY_LABELS[c]}
              active={filter === c}
              color={ACTIVITY_CATEGORY_ACCENT[c]}
              onClick={() => selectFilter(c)}
            />
          ))}
          <span className="mx-2 hidden h-4 w-px sm:inline-block" style={{ background: 'var(--line-strong)' }} />
          <FilterChip
            label={unreadOnly ? 'Unread only' : 'Showing all'}
            active={unreadOnly}
            color="var(--p-1)"
            onClick={toggleUnreadOnly}
          />
        </div>
      )}

      {/* List */}
      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={22} className="animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Bell size={32} />}
          title={filter === 'all' && !unreadOnly ? 'No activity yet' : 'Nothing matches the filter'}
          description={
            filter === 'all' && !unreadOnly
              ? 'New workspace activity will appear here as it happens.'
              : 'Try clearing the filter or showing read items too.'
          }
        />
      ) : (
        <ul
          className="divide-y rounded-xl border"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          {displayed.map((it) => (
            <li
              key={it.id}
              className="flex items-start gap-3 px-5 py-4 transition-colors"
              style={{
                background: it.read ? 'transparent' : 'color-mix(in srgb, var(--p-soft) 50%, transparent)',
                borderColor: 'var(--line-strong)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2)' }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = it.read
                  ? 'transparent'
                  : 'color-mix(in srgb, var(--p-soft) 50%, transparent)'
              }}
            >
              <span
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: `${ACTIVITY_CATEGORY_ACCENT[it.category]}1f`,
                  color: ACTIVITY_CATEGORY_ACCENT[it.category],
                }}
              >
                <AlertCircle size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <p
                    className="text-sm"
                    style={{ color: it.read ? 'var(--text-2)' : 'var(--text)', fontWeight: it.read ? 400 : 600 }}
                  >
                    {it.summary}
                  </p>
                  <span
                    className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none"
                    style={{
                      background: 'var(--bg-2)',
                      color: ACTIVITY_CATEGORY_ACCENT[it.category],
                      border: `1px solid color-mix(in srgb, ${ACTIVITY_CATEGORY_ACCENT[it.category]} 30%, transparent)`,
                    }}
                  >
                    {ACTIVITY_CATEGORY_LABELS[it.category]}
                  </span>
                </div>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {timeAgo(it.ts)}
                  {it.actor ? ` · by ${it.actor}` : ''}
                  {it.guildName ? ` · ${it.guildName}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {it.read ? (
                  <button
                    type="button"
                    onClick={() => markUnread([it.id])}
                    title="Mark as unread"
                    className="rounded-md p-1.5 transition"
                    style={{ color: 'var(--text-3)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
                  >
                    <MailOpen size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => markRead([it.id])}
                    title="Mark as read"
                    className="rounded-md p-1.5 transition"
                    style={{ color: 'var(--text-3)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
                  >
                    <CircleSlash size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Load older */}
      {filtered.length > 0 && (visibleCount < filtered.length || !reachedEnd) && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            {loadingMore && <Loader2 size={12} className="animate-spin" />}
            Load older...
          </button>
        </div>
      )}
      {reachedEnd && visibleCount >= filtered.length && filtered.length > 0 && (
        <p className="mt-5 text-center text-xs" style={{ color: 'var(--text-3)' }}>
          You’ve reached the oldest notification.
        </p>
      )}

      {clearOpen && (
        <ConfirmDialog
          title="Clear all notifications?"
          description="This permanently removes workspace activity entries (notes, tasks, incidents, member events). Moderation logs and per-server notifications stay where they live."
          confirmLabel={clearing ? 'Clearing…' : 'Clear all'}
          tone="destructive"
          busy={clearing}
          onCancel={() => { if (!clearing) setClearOpen(false) }}
          onConfirm={handleClearAll}
          fields={[]}
        />
      )}
    </div>
  )
}

function FilterChip({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
      style={{
        background: active ? `${color}1f` : 'var(--bg-2)',
        borderColor: active ? color : 'var(--line-strong)',
        color: active ? color : 'var(--text-2)',
      }}
    >
      {label}
    </button>
  )
}
