'use client'

import { useEffect, useMemo, useState } from 'react'
import { Clock, Flame, Gamepad2, X } from 'lucide-react'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import { BarList, StatTile, relativeTime } from '@/components/dashboard/gaming/gaming-style'
import { formatDuration, type PlayerStat } from '@/lib/gaming'
import type { Timeframe } from '@/lib/analytics'

/**
 * One member's gaming profile: playtime, favourite game, streak, the games they
 * played and their recent sessions.
 *
 * The ranking table this used to sit under moved to the Leaderboards page (all
 * boards live there now); the profile stayed with the Gaming module, opened
 * from the overview's "Top players" widget, because none of it is a ranking.
 */

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

export function GamingPlayerProfile({
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
