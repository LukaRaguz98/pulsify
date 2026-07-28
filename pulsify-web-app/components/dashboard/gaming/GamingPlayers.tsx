'use client'

import { useEffect, useMemo, useState } from 'react'
import { Clock, Flame, Gamepad2, Search, Trophy, Users, X } from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import { BarList, LiveDot, StatTile, relativeTime } from '@/components/dashboard/gaming/gaming-style'
import {
  LEADERBOARDS,
  LEADERBOARD_LABELS,
  buildLeaderboard,
  displayName,
  formatDuration,
  type LeaderboardKey,
  type PlayerStat,
} from '@/lib/gaming'
import type { Timeframe } from '@/lib/analytics'
import type { GamingPayload } from '@/components/dashboard/gaming/GamingContent'

/**
 * Players: five leaderboards over the same member aggregate, plus a profile
 * panel for any one of them.
 *
 * The boards are re-ranked in the browser rather than re-fetched — they all
 * read the same per-member rows, so switching board is a sort, not a query.
 */
export function GamingPlayers({
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
  const [board, setBoard] = useState<LeaderboardKey>('playtime')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<PlayerStat | null>(null)

  const rows = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    const pool = q
      ? data.players.filter((p) => (p.userName ?? '').toLowerCase().includes(q))
      : data.players
    return buildLeaderboard(pool, board, 100)
  }, [data, board, query])

  if (loading && !data) return <TableSkeleton rows={8} />
  if (!data) return null

  if (data.players.length === 0) {
    return (
      <EmptyState
        icon={<Users size={18} />}
        title="No players tracked yet"
        description="Members appear here once they've played something Discord can see."
      />
    )
  }

  return (
    <div className="space-y-8">
      <CategorySection
        icon={<Trophy size={14} />}
        title="Leaderboards"
        description="Ranked over the selected window. Select a member for their full profile."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-3)' }}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search members"
                aria-label="Search members"
                disabled={data.anonymise}
                className="rounded-lg border py-1.5 pl-7 pr-2.5 text-xs disabled:opacity-50"
                style={{
                  borderColor: 'var(--line-strong)',
                  background: 'var(--bg-2)',
                  color: 'var(--text)',
                }}
              />
            </div>
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap gap-1.5">
          {LEADERBOARDS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setBoard(key)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
              style={
                board === key
                  ? { background: 'var(--p-soft)', color: 'var(--p-1)' }
                  : { background: 'var(--bg-2)', color: 'var(--text-2)' }
              }
            >
              {LEADERBOARD_LABELS[key]}
            </button>
          ))}
        </div>

        {data.anonymise && (
          <p className="mb-3 text-xs" style={{ color: 'var(--text-3)' }}>
            Anonymised statistics are on for this server — members are shown by rank only.
          </p>
        )}

        {rows.length === 0 ? (
          <EmptyState
            icon={<Search size={18} />}
            title="No members match"
            description="Try a different search."
            variant="muted"
          />
        ) : (
          <div
            className="overflow-x-auto rounded-xl border"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
          >
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr
                  className="text-left text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--text-3)' }}
                >
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">{LEADERBOARD_LABELS[board]}</th>
                  <th className="px-4 py-3">Sessions</th>
                  <th className="px-4 py-3">Games</th>
                  <th className="px-4 py-3">Last played</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.player.userId}
                    onClick={() => !data.anonymise && setSelected(row.player)}
                    className="border-t transition-colors hover:bg-[var(--bg-2)]"
                    style={{
                      borderColor: 'var(--line)',
                      cursor: data.anonymise ? 'default' : 'pointer',
                    }}
                  >
                    <td className="px-4 py-3 font-semibold" style={{ color: 'var(--text-3)' }} data-label="Rank">
                      {row.rank}
                    </td>
                    <td className="px-4 py-3" data-label="Member">
                      <div className="flex items-center gap-2">
                        {row.player.currentlyPlaying && <LiveDot />}
                        <span className="font-medium text-foreground">
                          {displayName(row.player, data.anonymise, row.rank)}
                        </span>
                      </div>
                      {!data.anonymise && row.player.favouriteGame && (
                        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                          {row.player.favouriteGame}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground" data-label={LEADERBOARD_LABELS[board]}>
                      {row.display}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-2)' }} data-label="Sessions">
                      {row.player.totalSessions}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-2)' }} data-label="Games">
                      {row.player.uniqueGames}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-3)' }} data-label="Last played">
                      {relativeTime(row.player.lastSessionAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CategorySection>

      {selected && (
        <PlayerProfile
          guildId={guildId}
          tz={tz}
          timeframe={data.window.timeframe}
          player={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

type ProfilePayload = {
  player: PlayerStat
  rank: number
  totalRanked: number
  games: { gameKey: string; gameName: string; seconds: number; sessions: number; lastPlayedAt: string }[]
  recentSessions: {
    id: string
    gameName: string
    startedAt: string
    endedAt: string | null
    durationSeconds: number | null
  }[]
  sessionCount: number
  streak: { current: number; longest: number }
  gamesThisMonth: number
  hours: number[]
}

function PlayerProfile({
  guildId,
  tz,
  timeframe,
  player,
  onClose,
}: {
  guildId: string
  tz: string
  timeframe: Timeframe
  player: PlayerStat
  onClose: () => void
}) {
  const [detail, setDetail] = useState<ProfilePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  useDialogDismiss(onClose)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/guilds/${guildId}/gaming/players/${player.userId}?timeframe=${timeframe}&tz=${encodeURIComponent(tz)}`,
          { cache: 'no-store' },
        )
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(body.error ?? 'Could not load this profile.')
        setDetail(body as ProfilePayload)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this profile.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [guildId, player.userId, timeframe, tz])

  const peakHours = useMemo(() => {
    if (!detail) return []
    return detail.hours
      .map((seconds, hour) => ({ hour, seconds }))
      .filter((h) => h.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 3)
  }, [detail])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-label={`${player.userName ?? 'Member'} gaming profile`}
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border p-6 sm:rounded-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-foreground">
              {player.userName ?? 'Unknown member'}
            </h2>
            {detail && (
              <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
                Rank #{detail.rank} of {detail.totalRanked} · {detail.sessionCount} tracked sessions
              </p>
            )}
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
            icon={<Clock size={14} />}
            label="Total playtime"
            value={formatDuration(player.totalSeconds)}
            hint={`${player.totalSessions} sessions`}
          />
          <StatTile
            icon={<Gamepad2 size={14} />}
            label="Favourite"
            value={player.favouriteGame ?? '—'}
            hint={player.favouriteGame ? formatDuration(player.favouriteSeconds) : undefined}
          />
          <StatTile
            icon={<Clock size={14} />}
            label="Longest session"
            value={formatDuration(player.longestSeconds)}
            hint={`avg ${formatDuration(player.avgSessionSeconds)}`}
          />
          <StatTile
            icon={<Flame size={14} />}
            label="Streak"
            value={detail ? `${detail.streak.current} day${detail.streak.current === 1 ? '' : 's'}` : '—'}
            hint={detail ? `longest ${detail.streak.longest}` : undefined}
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
                Games played — {detail.gamesThisMonth} this month
              </h3>
              <BarList
                empty="No games recorded."
                rows={detail.games.slice(0, 8).map((g) => ({
                  key: g.gameKey,
                  label: g.gameName,
                  value: g.seconds,
                  display: formatDuration(g.seconds),
                  sub: `${g.sessions} session${g.sessions === 1 ? '' : 's'} · ${relativeTime(g.lastPlayedAt)}`,
                }))}
              />
            </div>

            {peakHours.length > 0 && (
              <div>
                <h3
                  className="mb-2 text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--text-3)' }}
                >
                  Most active hours
                </h3>
                <div className="flex flex-wrap gap-2">
                  {peakHours.map((h) => (
                    <span
                      key={h.hour}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-medium"
                      style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                    >
                      {String(h.hour).padStart(2, '0')}:00 — {formatDuration(h.seconds)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3
                className="mb-2 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'var(--text-3)' }}
              >
                Recent sessions
              </h3>
              <ul className="space-y-1.5">
                {detail.recentSessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm"
                    style={{ background: 'var(--bg-2)' }}
                  >
                    <span className="truncate font-medium text-foreground">{s.gameName}</span>
                    <span className="shrink-0 text-xs" style={{ color: 'var(--text-3)' }}>
                      {s.endedAt
                        ? formatDuration(s.durationSeconds ?? 0)
                        : 'in progress'}{' '}
                      · {relativeTime(s.startedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
