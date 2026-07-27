'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircle, CheckSquare, Download, FileJson, FileText, History, Loader2,
  RefreshCw, Sheet, X,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import type { ReadonlyURLSearchParams } from 'next/navigation'
import {
  EMPTY_FILTERS,
  EMPTY_STATS,
  TIMELINE_CATEGORIES,
  type TimelineCategory,
  dayHeading,
  filtersToParams,
  groupByDay,
  hasActiveFilters,
  type ExportFormat,
  type TimelineActorCount,
  type TimelineEvent,
  type TimelineFilters,
  type TimelineStats,
} from '@/lib/timeline'
import { TimelineStatsPanel } from './TimelineStats'
import { TimelineFilterBar } from './TimelineFilters'
import { TimelineEventCard } from './TimelineEventCard'
import { TimelineDetail } from './TimelineDetail'

type Props = { guildId: string }

type FeedResponse = {
  events: TimelineEvent[]
  nextCursor: string | null
  hasMore: boolean
  retentionDays: number | null
}

type StatsResponse = {
  stats: TimelineStats
  actors: TimelineActorCount[]
  retentionDays: number | null
}

/** A loaded page of the feed, tagged with the request it answered. */
type LoadedFeed = {
  key: string
  events: TimelineEvent[]
  cursor: string | null
  hasMore: boolean
  retentionDays: number | null
}

const PAGE_SIZE = 40
/** Typing in the search box shouldn't fire a query per keystroke. */
const SEARCH_DEBOUNCE_MS = 350

/**
 * Server Timeline (PULSIFY-63) — the server's history page.
 *
 * Everything on this page reads through one filter object: the feed, the
 * export, and the deep links out of the detail drawer. That's deliberate —
 * "export what I'm looking at" is the whole point of an audit view, and it only
 * stays true if there's exactly one definition of "what I'm looking at".
 */
export function TimelineContent({ guildId }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Deep links seed the initial filters — the command palette's "Review
  // moderation history" and a member page's "see this member's history" both
  // land here with the view already narrowed. Read once, at mount: after that
  // the filter bar owns the state, so navigating back to a stale URL can't
  // yank the view out from under someone mid-investigation.
  const [filters, setFilters] = useState<TimelineFilters>(() =>
    initialFilters(searchParams),
  )
  // The query the feed actually ran with — the raw filter's `query` is debounced
  // into this, so the fetch effect can depend on a value that doesn't change on
  // every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState(() => filters.query.trim())

  // The feed is stored together with the request key it answered, so "are we
  // loading?" is DERIVED (`feed.key !== requestKey`) instead of being a flag we
  // have to remember to flip on every filter change. Fewer states, and no
  // window where stale rows render as if they were current.
  const [feed, setFeed] = useState<LoadedFeed | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [stats, setStats] = useState<TimelineStats>(EMPTY_STATS)
  const [actors, setActors] = useState<TimelineActorCount[]>([])

  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detail, setDetail] = useState<TimelineEvent | null>(null)
  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  // Guards a stale response from overwriting a newer one when filters change
  // faster than the network answers.
  const requestRef = useRef(0)
  // Bumped by Refresh to re-run the first-page fetch without changing filters.
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(filters.query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [filters.query])

  /** The filter set as the API sees it — debounced query, everything else live. */
  const appliedFilters = useMemo(
    () => ({ ...filters, query: debouncedQuery }),
    [filters, debouncedQuery],
  )

  /** Identifies one filter combination + refresh generation. */
  const requestKey = useMemo(
    () => `${filtersToParams(appliedFilters).toString()}#${reloadToken}`,
    [appliedFilters, reloadToken],
  )

  const fetchPage = useCallback(
    async (nextCursor: string | null) => {
      const params = filtersToParams(appliedFilters)
      params.set('limit', String(PAGE_SIZE))
      if (nextCursor) params.set('cursor', nextCursor)
      const res = await fetch(`/api/guilds/${guildId}/timeline?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'The history could not be loaded.')
      return data as FeedResponse
    },
    [guildId, appliedFilters],
  )

  // First page — re-runs whenever the applied filters change, or Refresh bumps
  // the reload token. All state lands in the promise callbacks, never
  // synchronously in the effect body.
  useEffect(() => {
    const token = ++requestRef.current
    let cancelled = false

    fetchPage(null)
      .then((data) => {
        if (cancelled || token !== requestRef.current) return
        setError(null)
        setFeed({
          key: requestKey,
          events: data.events,
          cursor: data.nextCursor,
          hasMore: data.hasMore,
          retentionDays: data.retentionDays,
        })
      })
      .catch((e: Error) => {
        if (cancelled || token !== requestRef.current) return
        setError(e.message)
        setFeed({ key: requestKey, events: [], cursor: null, hasMore: false, retentionDays: null })
      })

    return () => { cancelled = true }
  }, [fetchPage, requestKey])

  // Statistics are deliberately NOT filtered: they describe the server's
  // activity over the retained window, which is the context you read the
  // filtered feed against. Re-read on mount and on Refresh.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/guilds/${guildId}/timeline/stats`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: StatsResponse | null) => {
        if (cancelled || !data) return
        setStats(data.stats)
        setActors(data.actors)
      })
      .catch(() => {
        // Statistics are a header, not the page — a failure here leaves the
        // zeroed strip in place rather than blocking the feed.
      })
    return () => { cancelled = true }
  }, [guildId, reloadToken])

  // Memoised so the day-grouping below isn't recomputed on every unrelated
  // render (opening the detail drawer, ticking a checkbox).
  const events = useMemo(() => feed?.events ?? [], [feed])
  const loading = feed === null || feed.key !== requestKey
  const hasMore = feed?.hasMore ?? false
  const retentionDays = feed?.retentionDays ?? null

  const loadMore = useCallback(async () => {
    if (loadingMore || !feed || feed.key !== requestKey || !feed.hasMore || !feed.cursor) return
    setLoadingMore(true)
    try {
      const data = await fetchPage(feed.cursor)
      setFeed((prev) => {
        // Drop the page if the filters moved on while it was in flight.
        if (!prev || prev.key !== requestKey) return prev
        // De-dupe defensively: a new event landing at the head while you scroll
        // can otherwise push a row into two pages.
        const seen = new Set(prev.events.map((e) => e.id))
        return {
          ...prev,
          events: [...prev.events, ...data.events.filter((e) => !seen.has(e.id))],
          cursor: data.nextCursor,
          hasMore: data.hasMore,
        }
      })
    } catch (e) {
      setError((e as Error).message)
      setFeed((prev) => (prev ? { ...prev, hasMore: false } : prev))
    } finally {
      setLoadingMore(false)
    }
  }, [feed, requestKey, loadingMore, fetchPage])

  // Infinite scroll: a sentinel below the feed pulls the next page into view
  // before the user reaches the bottom.
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void loadMore() },
      { rootMargin: '400px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  /** Re-run the feed and the statistics without touching the filters. */
  const refresh = useCallback(() => setReloadToken((n) => n + 1), [])

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  function stopSelecting() {
    setSelecting(false)
    setSelected(new Set())
  }

  async function runExport(format: ExportFormat) {
    setExporting(format)
    setExportOpen(false)
    try {
      const params = filtersToParams(appliedFilters)
      params.set('format', format)
      // Selected events win over the filters — that's what "selected" means.
      if (selecting && selected.size > 0) params.set('ids', [...selected].join(','))
      const res = await fetch(`/api/guilds/${guildId}/timeline/export?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'The export failed. Try again in a moment.')
        return
      }
      const blob = await res.blob()
      const name = filenameFromResponse(res) ?? `history.${format}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError("Couldn't reach the server to build that export.")
    } finally {
      setExporting(null)
    }
  }

  const groups = useMemo(() => groupByDay(events), [events])
  const filtered = hasActiveFilters(appliedFilters)
  const activeModules = useMemo(() => stats.modules.map((m) => m.key), [stats.modules])

  const exportScopeLabel =
    selecting && selected.size > 0
      ? `${selected.size} selected event${selected.size === 1 ? '' : 's'}`
      : filtered
        ? 'the filtered history'
        : 'the complete history'

  return (
    <div className="page-content">
      <PageHeader
        title="History"
        helpId="timeline"
        description="Every significant change to this server, in order — made in Pulsify or directly in Discord."
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
            <button
              type="button"
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: selecting ? 'var(--p-soft)' : undefined,
                borderColor: selecting ? 'var(--p-1)' : 'var(--line-strong)',
                color: selecting ? 'var(--p-1)' : 'var(--text-2)',
              }}
            >
              {selecting ? <X size={12} /> : <CheckSquare size={12} />}
              {selecting ? `Selecting (${selected.size})` : 'Select events'}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setExportOpen((v) => !v)}
                disabled={exporting !== null}
                aria-expanded={exportOpen}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-60"
                style={{ background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)' }}
              >
                {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                Export
              </button>
              {exportOpen && (
                <>
                  {/* Click-away layer — cheaper and more predictable here than
                      a document listener that has to dodge the button itself. */}
                  <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                  <div
                    className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border shadow-2xl"
                    style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
                  >
                    <p className="border-b px-3 py-2 text-[11px]" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
                      Exports {exportScopeLabel}.
                    </p>
                    <ExportOption icon={<Sheet size={13} />} label="CSV" hint="Spreadsheets" onClick={() => runExport('csv')} />
                    <ExportOption icon={<FileJson size={13} />} label="JSON" hint="Full detail, machine-readable" onClick={() => runExport('json')} />
                    <ExportOption icon={<FileText size={13} />} label="PDF" hint="Shareable report" onClick={() => runExport('pdf')} />
                  </div>
                </>
              )}
            </div>
          </div>
        }
      />

      <div className="mb-6">
        <TimelineStatsPanel stats={stats} />
      </div>

      <TimelineFilterBar
        filters={filters}
        onChange={setFilters}
        actors={actors}
        activeModules={activeModules}
      />

      {error && (
        <div
          className="mb-4 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.35)', color: '#f87171' }}
          role="alert"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p>{error}</p>
            <button
              type="button"
              onClick={refresh}
              className="mt-1 text-xs font-semibold underline"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {loading && events.length === 0 ? (
        <TimelineSkeleton />
      ) : events.length === 0 ? (
        <EmptyState
          icon={<History size={32} />}
          variant={filtered ? 'muted' : 'accent'}
          title={filtered ? 'Nothing matches these filters' : 'No history yet'}
          description={
            filtered
              ? 'Try a wider date range, another category, or clear the search.'
              : 'As soon as something changes in this server — a role, a channel, a member, a setting — it will appear here.'
          }
          action={
            filtered ? (
              <button
                type="button"
                onClick={() => setFilters({ ...EMPTY_FILTERS })}
                className="rounded-lg border px-3 py-1.5 text-sm font-medium transition"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-2)' }}>
                  {dayHeading(group.key)}
                </h2>
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {group.events.length} event{group.events.length === 1 ? '' : 's'}
                </span>
                <div className="h-px flex-1" style={{ background: 'var(--line-strong)' }} />
              </div>
              {/* The rail: one continuous line behind the markers, drawn on the
                  list so it doesn't break between cards. */}
              <ul className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute bottom-6 left-4 top-6 w-px"
                  style={{ background: 'var(--line-strong)' }}
                />
                {group.events.map((event) => (
                  <TimelineEventCard
                    key={event.id}
                    event={event}
                    selectable={selecting}
                    selected={selected.has(event.id)}
                    onToggleSelect={toggleSelect}
                    onOpen={setDetail}
                    onNavigate={(href) => router.push(href)}
                  />
                ))}
              </ul>
            </section>
          ))}

          {/* Infinite-scroll sentinel + its fallback button, so keyboard and
              reduced-motion users are never stuck at the bottom. */}
          <div ref={sentinelRef} />
          {hasMore ? (
            <div className="flex justify-center py-2">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              >
                {loadingMore && <Loader2 size={12} className="animate-spin" />}
                Load older events
              </button>
            </div>
          ) : (
            <p className="py-2 text-center text-xs" style={{ color: 'var(--text-3)' }}>
              {retentionDays
                ? `You've reached the start of the ${retentionDays}-day history this server's plan retains.`
                : "You've reached the beginning of this server's history."}
            </p>
          )}
        </div>
      )}

      {detail && (
        <TimelineDetail
          event={detail}
          guildId={guildId}
          onClose={() => setDetail(null)}
          onNavigate={(href) => { setDetail(null); router.push(href) }}
          onFilterActor={(actorId) => {
            setDetail(null)
            setFilters({ ...EMPTY_FILTERS, actor: actorId })
          }}
          onFilterMember={(memberId) => {
            setDetail(null)
            setFilters({ ...EMPTY_FILTERS, member: memberId })
          }}
        />
      )}

    </div>
  )
}

/**
 * Seed filters from the URL. Only the parameters a deep link realistically
 * carries are honoured; anything unrecognised is ignored rather than rejected,
 * so an old bookmark degrades to the full timeline.
 */
function initialFilters(params: URLSearchParams | ReadonlyURLSearchParams): TimelineFilters {
  const category = params.get('category')
  return {
    ...EMPTY_FILTERS,
    category:
      category && (TIMELINE_CATEGORIES as readonly string[]).includes(category)
        ? (category as TimelineCategory)
        : 'all',
    actor: params.get('actor') ?? 'all',
    member: params.get('member') ?? 'all',
    module: params.get('module') ?? 'all',
    eventType: params.get('type') ?? 'all',
    query: params.get('q') ?? '',
  }
}

function ExportOption({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-2)]"
    >
      <span style={{ color: 'var(--p-1)' }}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-[11px]" style={{ color: 'var(--text-3)' }}>{hint}</span>
      </span>
    </button>
  )
}

/** Skeleton shaped like the rail, so the page doesn't reflow when data lands. */
function TimelineSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      {[0, 1].map((group) => (
        <section key={group}>
          <div className="mb-2 flex items-center gap-3">
            <div className="h-3 w-24 animate-pulse rounded" style={{ background: 'var(--bg-2)' }} />
            <div className="h-px flex-1" style={{ background: 'var(--line-strong)' }} />
          </div>
          <ul className="relative space-y-2">
            {[0, 1, 2].map((row) => (
              <li key={row} className="flex gap-3">
                <div className="mt-4 h-8 w-8 shrink-0 animate-pulse rounded-full" style={{ background: 'var(--bg-2)' }} />
                <div
                  className="flex-1 rounded-xl border p-4"
                  style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
                >
                  <div className="h-3.5 w-2/5 animate-pulse rounded" style={{ background: 'var(--bg-2)' }} />
                  <div className="mt-2 h-3 w-3/5 animate-pulse rounded" style={{ background: 'var(--bg-2)' }} />
                  <div className="mt-3 h-2.5 w-1/3 animate-pulse rounded" style={{ background: 'var(--bg-2)' }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** Prefer the server's filename so the export carries the server + date stem. */
function filenameFromResponse(res: Response): string | null {
  const header = res.headers.get('Content-Disposition')
  const match = header ? /filename="([^"]+)"/.exec(header) : null
  return match ? match[1] : null
}
