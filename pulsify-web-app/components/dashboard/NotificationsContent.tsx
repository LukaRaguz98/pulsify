'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell, CheckCheck, Filter, Loader2, RefreshCw, Trash2, X,
  AlertCircle, CircleSlash, ArrowUpRight, MailOpen,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CATEGORY_LABELS, type NotificationCategory } from '@/lib/notifications'
import { useNotifications, type NotificationRow } from './notifications/NotificationsProvider'
import { SEVERITY_BG, SEVERITY_COLOR, CATEGORY_ACCENT, formatRelativeTime } from './notifications/notification-style'

type Props = { guildId: string }

type Filters = {
  category: 'all' | NotificationCategory
  showRead: boolean
}

const CATEGORY_ORDER: NotificationCategory[] = [
  'members', 'moderation', 'roles', 'events', 'channels', 'automations', 'settings', 'bot',
]

export function NotificationsContent({ guildId }: Props) {
  const router = useRouter()
  const {
    notifications, unreadCount, loading, refresh, markRead, markAllRead, markUnread, loadMore,
  } = useNotifications()

  const [filters, setFilters] = useState<Filters>({ category: 'all', showRead: true })
  const [olderRows, setOlderRows] = useState<NotificationRow[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [reachedEnd, setReachedEnd] = useState(false)
  const [selected, setSelected] = useState<NotificationRow | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)

  // Always re-fetch when the page mounts. Provider already fetched once on
  // layout mount, but if that first call lost the Discord rate-limit lottery
  // the bell sat empty until you clicked Refresh. Triggering again here
  // guarantees the page shows the latest data the moment you open it.
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allRows = useMemo(() => {
    // Merge live notifications + paginated older rows. De-dupe in case the
    // realtime feed catches up to a row we already paginated past.
    const seen = new Set<string>()
    const merged: NotificationRow[] = []
    for (const list of [notifications, olderRows]) {
      for (const n of list) {
        if (!seen.has(n.id)) {
          seen.add(n.id)
          merged.push(n)
        }
      }
    }
    return merged.sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
  }, [notifications, olderRows])

  const visible = useMemo(() => {
    return allRows.filter((n) => {
      if (filters.category !== 'all' && n.category !== filters.category) return false
      if (!filters.showRead && n.read) return false
      return true
    })
  }, [allRows, filters])

  async function handleLoadMore() {
    if (loadingMore || reachedEnd) return
    const oldest = allRows[allRows.length - 1]
    if (!oldest) return
    setLoadingMore(true)
    const more = await loadMore(oldest.created_at)
    setLoadingMore(false)
    if (more.length === 0) {
      setReachedEnd(true)
      return
    }
    setOlderRows((prev) => [...prev, ...more])
  }

  async function handleClearAll() {
    setClearing(true)
    const res = await fetch(`/api/guilds/${guildId}/notifications`, { method: 'DELETE' })
    setClearing(false)
    setClearOpen(false)
    if (res.ok) {
      setOlderRows([])
      setReachedEnd(true)
      await refresh()
    }
  }

  function openDetails(n: NotificationRow) {
    setSelected(n)
    if (!n.read) markRead([n.id])
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Notifications"
        description="Real-time activity feed for this server. New entries appear without refresh."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refresh()}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllRead()}
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
              disabled={allRows.length === 0}
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
          </div>
        }
      />

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
          <Filter size={11} /> Filter
        </span>
        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, category: 'all' }))}
          className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
          style={{
            background: filters.category === 'all' ? 'var(--p-soft)' : 'var(--bg-2)',
            borderColor: filters.category === 'all' ? 'var(--p-1)' : 'var(--line-strong)',
            color: filters.category === 'all' ? 'var(--p-1)' : 'var(--text-2)',
          }}
        >
          All
        </button>
        {CATEGORY_ORDER.map((cat) => {
          const active = filters.category === cat
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, category: cat }))}
              className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
              style={{
                background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                color: active ? 'var(--p-1)' : 'var(--text-2)',
              }}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          )
        })}
        <span className="mx-2 hidden h-4 w-px sm:inline-block" style={{ background: 'var(--line-strong)' }} />
        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, showRead: !f.showRead }))}
          className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
          style={{
            background: !filters.showRead ? 'var(--p-soft)' : 'var(--bg-2)',
            borderColor: !filters.showRead ? 'var(--p-1)' : 'var(--line-strong)',
            color: !filters.showRead ? 'var(--p-1)' : 'var(--text-2)',
          }}
        >
          {filters.showRead ? 'Showing all' : 'Unread only'}
        </button>
      </div>

      {/* List */}
      {loading && allRows.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={22} className="animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Bell size={32} />}
          title={filters.category === 'all' && filters.showRead ? 'No activity yet' : 'Nothing matches the filter'}
          description={
            filters.category === 'all' && filters.showRead
              ? 'New server activity will appear here as it happens.'
              : 'Try selecting another category or showing read items too.'
          }
        />
      ) : (
        <ul
          className="divide-y rounded-xl border"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          {visible.map((n) => (
            <li
              key={n.id}
              className="flex items-start gap-3 px-5 py-4 transition-colors"
              style={{
                background: n.read ? 'transparent' : 'color-mix(in srgb, var(--p-soft) 50%, transparent)',
                borderColor: 'var(--line-strong)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2)' }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = n.read
                  ? 'transparent'
                  : 'color-mix(in srgb, var(--p-soft) 50%, transparent)'
              }}
            >
              <span
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ background: SEVERITY_BG[n.severity], color: SEVERITY_COLOR[n.severity] }}
              >
                <AlertCircle size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p
                    className="truncate text-sm"
                    style={{ color: n.read ? 'var(--text-2)' : 'var(--text)', fontWeight: n.read ? 400 : 600 }}
                  >
                    {n.title}
                  </p>
                  <span
                    className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none"
                    style={{
                      background: 'var(--bg-2)',
                      color: CATEGORY_ACCENT[n.category],
                      border: `1px solid color-mix(in srgb, ${CATEGORY_ACCENT[n.category]} 30%, transparent)`,
                    }}
                  >
                    {CATEGORY_LABELS[n.category]}
                  </span>
                </div>
                {n.body && (
                  <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: 'var(--text-3)' }}>{n.body}</p>
                )}
                <div className="mt-1 flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-3)' }}>
                  <span>{formatRelativeTime(n.created_at)}</span>
                  {n.actor_name && <span>· by {n.actor_name}</span>}
                  {n.target_name && !n.actor_name && <span>· {n.target_name}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => openDetails(n)}
                  title="View details"
                  className="rounded-md p-1.5 transition"
                  style={{ color: 'var(--text-3)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
                >
                  <ArrowUpRight size={14} />
                </button>
                {n.read ? (
                  <button
                    type="button"
                    onClick={() => markUnread([n.id])}
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
                    onClick={() => markRead([n.id])}
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

      {/* Load more */}
      {visible.length > 0 && !reachedEnd && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            {loadingMore && <Loader2 size={12} className="animate-spin" />}
            Load older
          </button>
        </div>
      )}
      {reachedEnd && visible.length > 0 && (
        <p className="mt-5 text-center text-xs" style={{ color: 'var(--text-3)' }}>
          Older activity has been cleared up to your retention window.
        </p>
      )}

      {/* Detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
          onClick={() => setSelected(null)}
        >
          <div
            // overflow-hidden clips the footer's bg-2 fill so the rounded
            // bottom corners stay rounded (otherwise the square footer
            // square-cuts them).
            className="w-full max-w-lg overflow-hidden rounded-xl border shadow-2xl"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-start gap-3 border-b px-5 py-4"
              style={{ borderColor: 'var(--line-strong)' }}
            >
              <span
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ background: SEVERITY_BG[selected.severity], color: SEVERITY_COLOR[selected.severity] }}
              >
                <AlertCircle size={16} />
              </span>
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-foreground">{selected.title}</h2>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
                  {new Date(selected.created_at).toLocaleString()} · {CATEGORY_LABELS[selected.category]} · {selected.severity}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="rounded p-1 text-muted-foreground transition hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              {selected.body && (
                <p className="text-sm text-muted-foreground">{selected.body}</p>
              )}
              <dl className="grid grid-cols-2 gap-3 text-xs">
                {(selected.actor_name || selected.actor_username) && (
                  <DetailRow label="Actor" value={formatActor(selected.actor_name, selected.actor_username)} />
                )}
                {selected.target_name && (
                  <DetailRow label="Target" value={selected.target_name} />
                )}
                {selected.target_id && (
                  <DetailRow label="Target ID" value={selected.target_id} mono />
                )}
                <DetailRow label="Type" value={selected.type} mono />
              </dl>
              {Object.keys(selected.metadata ?? {}).length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                    Metadata
                  </p>
                  <pre
                    className="overflow-x-auto rounded-lg border p-3 text-[11px] leading-relaxed"
                    style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                  >
                    {JSON.stringify(selected.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            <div
              className="flex items-center justify-end gap-2 border-t px-5 py-3"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
            >
              {selected.link && (
                <button
                  type="button"
                  onClick={() => {
                    const link = selected.link
                    setSelected(null)
                    if (link) router.push(link)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition"
                  style={{ background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)' }}
                >
                  Open
                  <ArrowUpRight size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition"
                style={{ borderColor: 'var(--line-strong)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear-all confirm */}
      {clearOpen && (
        <ConfirmDialog
          title="Clear all notifications?"
          description="This removes every notification in this server for everyone, including read history. This action cannot be undone."
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

/**
 * Combine the server display name + raw @handle into "Display (username)".
 * If only one is available, render that alone; if both are present and
 * identical (user with no separate display name), skip the parens to avoid
 * "luka (luka)".
 */
function formatActor(name: string | null, handle: string | null): string {
  if (name && handle && name !== handle) return `${name} (${handle})`
  return name ?? handle ?? ''
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
        {label}
      </dt>
      <dd className={mono ? 'mt-0.5 font-mono text-foreground' : 'mt-0.5 text-foreground'}>
        {value}
      </dd>
    </div>
  )
}
