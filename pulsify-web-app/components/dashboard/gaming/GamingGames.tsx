'use client'

import { useEffect, useMemo, useState } from 'react'
import { Gamepad2, Search, Sparkles, X } from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import { BarList, LiveDot, StatTile, TrendBadge, relativeTime } from '@/components/dashboard/gaming/gaming-style'
import { RankBadge } from '@/components/dashboard/RankBadge'
import {
  DataRow,
  DataTable,
  DataTableHead,
  RankHeader,
  SortHeader,
  RANK_CELL_STYLE,
  RANK_SORT,
  nextRankedSort,
  rankAndSort,
  type SortState,
} from '@/components/ui/data-table'
import {
  displayName,
  formatDuration,
  sortGames,
  type DailyPoint,
  type GameStat,
  type GameTrend,
} from '@/lib/gaming'
import type { Timeframe } from '@/lib/analytics'
import type { GamingPayload } from '@/components/dashboard/gaming/GamingContent'

/**
 * Most Played Games: the rankings, plus a detail panel for any one game.
 *
 * Sorting and searching happen in the browser against the payload the shell
 * already fetched — the whole game list for a window is at most a few hundred
 * rows, and a round trip per sort would make the table feel worse than it is.
 * Only the detail panel fetches, because per-game history is the one thing not
 * in the shared payload.
 */
/** Column → value, for the header sort. Trend reads the ratio behind the badge
 *  so "which games are moving" is one click, not a separate view. */
function gameValues(
  trendByKey: Map<string, GameTrend>,
): Record<string, (g: GameStat) => number | string> {
  return {
    name: (g) => g.gameName,
    playtime: (g) => g.totalSeconds,
    players: (g) => g.uniquePlayers,
    sessions: (g) => g.totalSessions,
    avgSession: (g) => g.avgSessionSeconds,
    lastPlayed: (g) => (g.lastSeenAt ? Date.parse(g.lastSeenAt) : 0),
    trend: (g) => trendByKey.get(g.gameKey)?.changeRatio ?? 0,
  }
}

export function GamingGames({
  data,
  loading,
  guildId,
  tz,
}: {
  data: GamingPayload | null
  loading: boolean
  guildId: string
  tz: string
}) {
  // The table sorts by header click, exactly like the leaderboards: the list
  // arrives ranked by playtime (that ranking IS the "#" column) and any other
  // column re-orders it in the browser.
  const [sort, setSort] = useState<SortState>(RANK_SORT)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selected, setSelected] = useState<GameStat | null>(null)

  const trendByKey = useMemo(
    () => new Map((data?.trends ?? []).map((t) => [t.game.gameKey, t])),
    [data?.trends],
  )

  const rows = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    const filtered = q
      ? data.games.filter((g) => g.gameName.toLowerCase().includes(q))
      : data.games
    const values = gameValues(trendByKey)
    return rankAndSort(sortGames(filtered, 'playtime'), sort, values)
  }, [data, sort, query, trendByKey])

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const paged = rows.slice((safePage - 1) * pageSize, safePage * pageSize)

  function handleSort(key: string) {
    setSort((prev) => nextRankedSort(prev, key))
    setPage(1)
  }

  if (loading && !data) return <TableSkeleton rows={8} />
  if (!data) return null

  if (data.games.length === 0) {
    return (
      <EmptyState
        icon={<Gamepad2 size={18} />}
        title="No games tracked yet"
        description="Games appear here as soon as members start playing something Discord can see."
      />
    )
  }

  return (
    <div className="space-y-8">
      {data.newGames.length > 0 && (
        <CategorySection
          icon={<Sparkles size={14} />}
          title="Newly played"
          description="Games this server hadn't touched before this window."
        >
          <div className="flex flex-wrap gap-2">
            {data.newGames.slice(0, 12).map((g) => (
              <button
                key={g.gameKey}
                type="button"
                onClick={() => setSelected(g)}
                className="rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors"
                style={{
                  borderColor: 'var(--line-strong)',
                  background: 'var(--bg-2)',
                  color: 'var(--text-2)',
                }}
              >
                {g.gameName}
                <span className="ml-1.5" style={{ color: 'var(--text-3)' }}>
                  {relativeTime(g.firstSeenAt)}
                </span>
              </button>
            ))}
          </div>
        </CategorySection>
      )}

      <CategorySection
        icon={<Gamepad2 size={14} />}
        title="All games"
        description="Every game tracked in this window. Select one for its full breakdown."
        action={
          // No sort dropdown: the column headers sort the table, the same way
          // they do on every other ranked table in the dashboard.
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-3)' }}
            />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              placeholder="Search games"
              aria-label="Search games"
              className="rounded-lg border py-1.5 pl-7 pr-2.5 text-xs"
              style={{
                borderColor: 'var(--line-strong)',
                background: 'var(--bg-2)',
                color: 'var(--text)',
              }}
            />
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={<Search size={18} />}
            title="No games match"
            description="Try a different search."
            variant="muted"
          />
        ) : (
          <DataTable
            minWidth={860}
            pager={{
              page: safePage,
              pageSize,
              total: rows.length,
              onPageChange: setPage,
              onPageSizeChange: (size) => {
                setPageSize(size)
                setPage(1)
              },
            }}
          >
            <DataTableHead>
              <RankHeader sort={sort} onSort={handleSort} />
              <SortHeader label="Game" columnKey="name" sort={sort} onSort={handleSort} />
              <SortHeader label="Playtime" columnKey="playtime" sort={sort} onSort={handleSort} />
              <SortHeader label="Players" columnKey="players" sort={sort} onSort={handleSort} />
              <SortHeader label="Sessions" columnKey="sessions" sort={sort} onSort={handleSort} />
              <SortHeader label="Avg session" columnKey="avgSession" sort={sort} onSort={handleSort} />
              <SortHeader label="Last played" columnKey="lastPlayed" sort={sort} onSort={handleSort} />
              <SortHeader label="Trend" columnKey="trend" sort={sort} onSort={handleSort} />
            </DataTableHead>
            <tbody>
              {paged.map(({ rank, row: g }) => {
                const trend = trendByKey.get(g.gameKey)
                return (
                  <DataRow key={g.gameKey} interactive onClick={() => setSelected(g)}>
                    <td className="px-4 py-3" data-label="" style={RANK_CELL_STYLE}>
                      <RankBadge rank={rank} />
                    </td>
                    <td className="px-4 py-3" data-label="">
                      <div className="flex items-center gap-2">
                        {g.currentlyPlaying > 0 && <LiveDot />}
                        <p className="truncate font-medium text-foreground">{g.gameName}</p>
                      </div>
                      {g.currentlyPlaying > 0 && (
                        <p className="mt-0.5 truncate text-xs text-subtle">
                          {g.currentlyPlaying} playing now
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-bold text-foreground" data-label="Playtime">
                      {formatDuration(g.totalSeconds)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground" data-label="Players">
                      {g.uniquePlayers.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground" data-label="Sessions">
                      {g.totalSessions.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground" data-label="Avg session">
                      {formatDuration(g.avgSessionSeconds)}
                    </td>
                    <td className="px-4 py-3 text-xs text-subtle" data-label="Last played">
                      {relativeTime(g.lastSeenAt)}
                    </td>
                    <td className="px-4 py-3" data-label="Trend">
                      {trend ? <TrendBadge trend={trend} /> : <span className="text-xs text-subtle">—</span>}
                    </td>
                  </DataRow>
                )
              })}
            </tbody>
          </DataTable>
        )}
      </CategorySection>

      {selected && (
        <GameDetail
          // Keying on the game remounts the panel when a different one is
          // opened, resetting its fetch state without an effect clearing it.
          key={selected.gameKey}
          guildId={guildId}
          tz={tz}
          timeframe={data.window.timeframe}
          game={selected}
          anonymise={data.anonymise}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

type GameDetailPayload = {
  game: GameStat
  players: { userId: string; userName: string | null; seconds: number; sessions: number; lastPlayedAt: string }[]
  daily: DailyPoint[]
}

function GameDetail({
  guildId,
  tz,
  timeframe,
  game,
  anonymise,
  onClose,
}: {
  guildId: string
  tz: string
  timeframe: Timeframe
  game: GameStat
  anonymise: boolean
  onClose: () => void
}) {
  const [detail, setDetail] = useState<GameDetailPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  useDialogDismiss(onClose)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/guilds/${guildId}/gaming/games/${encodeURIComponent(game.gameKey)}?timeframe=${timeframe}&tz=${encodeURIComponent(tz)}`,
          { cache: 'no-store' },
        )
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(body.error ?? 'Could not load this game.')
        setDetail(body as GameDetailPayload)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this game.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [guildId, game.gameKey, timeframe, tz])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-label={`${game.gameName} details`}
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border p-6 sm:rounded-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-foreground">{game.gameName}</h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
              First seen {relativeTime(game.firstSeenAt)} · last played {relativeTime(game.lastSeenAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5"
            style={{ color: 'var(--text-3)' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={<Gamepad2 size={14} />}
            label="Server playtime"
            value={formatDuration(game.totalSeconds)}
            hint={`${game.totalSessions} sessions`}
          />
          <StatTile
            icon={<Gamepad2 size={14} />}
            label="Players"
            value={String(game.uniquePlayers)}
            hint={`${game.playersWeek} this week`}
          />
          <StatTile
            icon={<Gamepad2 size={14} />}
            label="Average session"
            value={formatDuration(game.avgSessionSeconds)}
          />
          <StatTile
            icon={<Gamepad2 size={14} />}
            label="Longest session"
            value={formatDuration(game.longestSeconds)}
          />
        </div>

        {error && (
          <p className="mt-5 text-sm" style={{ color: '#f87171' }}>
            {error}
          </p>
        )}

        {!error && !detail && <div className="mt-5"><TableSkeleton rows={4} /></div>}

        {detail && (
          <div className="mt-6 space-y-6">
            <div>
              <h3
                className="mb-2 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'var(--text-3)' }}
              >
                Most active players
              </h3>
              <BarList
                empty="No players recorded."
                rows={detail.players.slice(0, 8).map((p, i) => ({
                  key: p.userId,
                  label: displayName({ userId: p.userId, userName: p.userName }, anonymise, i + 1),
                  value: p.seconds,
                  display: formatDuration(p.seconds),
                  sub: `${p.sessions} session${p.sessions === 1 ? '' : 's'} · ${relativeTime(p.lastPlayedAt)}`,
                }))}
              />
            </div>

            <div>
              <h3
                className="mb-2 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'var(--text-3)' }}
              >
                Daily activity
              </h3>
              <Sparkline points={detail.daily} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A dependency-free bar sparkline. The module already avoids a charting library
 * everywhere else (same stance as [[role-hierarchy]]'s PNG export), and a
 * daily series is just a row of proportional bars.
 */
function Sparkline({ points }: { points: DailyPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-3)' }}>
        No daily activity in this window.
      </p>
    )
  }
  const max = Math.max(...points.map((p) => p.totalSeconds), 1)
  return (
    <div className="flex h-24 items-end gap-0.5">
      {points.map((p) => (
        <div
          key={p.day}
          className="flex-1 rounded-t transition-all"
          title={`${p.day} — ${formatDuration(p.totalSeconds)}`}
          style={{
            height: `${Math.max(2, (p.totalSeconds / max) * 100)}%`,
            background: 'var(--p-1)',
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  )
}
