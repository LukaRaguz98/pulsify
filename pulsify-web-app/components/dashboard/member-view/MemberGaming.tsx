'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Clock, Gamepad2, Hourglass, Timer, Trophy, Users } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { TimeframeFilter } from '@/components/dashboard/TimeframeFilter'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { GamingLive } from '@/components/dashboard/gaming/GamingLive'
import { BarList, StatTile, hourLabel } from '@/components/dashboard/gaming/gaming-style'
import {
  WEEKDAY_LABELS,
  displayName,
  formatDuration,
  formatHours,
  type GameStat,
  type GamingOverview,
  type PeakActivity,
  type PlayerStat,
} from '@/lib/gaming'
import type { Timeframe } from '@/lib/analytics'

/**
 * Gaming, for members (PULSIFY-64).
 *
 * The admin module answers "what is my community doing"; this answers "who can
 * I play with tonight". Same data, a different question — so this is a separate
 * component rather than the admin view with its controls hidden, and it reads a
 * separate, narrower endpoint (`/gaming/community`) rather than the admin one.
 *
 * The ordering follows how useful each section is to someone looking for
 * company: who is playing RIGHT NOW first, then who plays what, then the
 * rankings, then the server's rhythm. Everything management-shaped — settings,
 * exports, per-member drill-downs, retention and upgrade messaging — is absent
 * rather than disabled.
 */

type CommunityPayload = {
  enabled: boolean
  anonymise: boolean
  window?: { timeframe: Timeframe; days: number | null; periodLabel: string; timezone: string }
  overview?: GamingOverview
  games?: GameStat[]
  players?: PlayerStat[]
  /** Null when the server's plan doesn't include the derived views. */
  peaks?: PeakActivity | null
}

/** Games with enough players to be worth suggesting as something to join. */
const SQUAD_MIN_PLAYERS = 2
const SQUAD_GAMES = 6

export function MemberGaming({ guildId, guildName }: { guildId: string; guildName: string }) {
  const [timeframe, setTimeframe] = useState<Timeframe>('30d')
  const [data, setData] = useState<CommunityPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const tz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/guilds/${guildId}/gaming/community?timeframe=${timeframe}&tz=${encodeURIComponent(tz)}`,
          { cache: 'no-store' },
        )
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(body.error ?? 'Gaming activity could not be loaded.')
        setData(body as CommunityPayload)
        setError(null)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Gaming activity could not be loaded.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [guildId, timeframe, tz, reloadKey])

  const reload = useCallback(() => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }, [])

  const anonymise = data?.anonymise ?? false
  // Memoised because `squads` below depends on them: a fresh [] on every render
  // would rebuild the grouping on every render too.
  const games = useMemo(() => data?.games ?? [], [data])
  const players = useMemo(() => data?.players ?? [], [data])

  /**
   * Who to play what with. Built from each member's FAVOURITE game rather than
   * from everything they have ever launched — "these people play this" is a
   * useful suggestion, "these 40 people opened it once" is a phone book.
   */
  const squads = useMemo(() => {
    if (anonymise) return []
    const byGame = new Map<string, PlayerStat[]>()
    for (const p of players) {
      if (!p.favouriteGame) continue
      const list = byGame.get(p.favouriteGame) ?? []
      list.push(p)
      byGame.set(p.favouriteGame, list)
    }
    return [...byGame.entries()]
      .filter(([, list]) => list.length >= SQUAD_MIN_PLAYERS)
      .map(([game, list]) => ({
        game,
        players: list,
        // Rank the suggestions by the time this group actually puts in, so the
        // game the server lives in comes before the one three people dabble in.
        seconds: list.reduce((sum, p) => sum + p.favouriteSeconds, 0),
        playingNow: games.find((g) => g.gameName === game)?.currentlyPlaying ?? 0,
      }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, SQUAD_GAMES)
  }, [players, games, anonymise])

  const header = (
    <PageHeader
      title="Gaming"
      helpId="gaming"
      description={
        <>
          What <span className="font-medium text-foreground">{guildName}</span> plays, who is
          online right now, and who to team up with
        </>
      }
      action={
        <div className="flex flex-wrap items-center gap-3">
          <TimeframeFilter value={timeframe} onChange={setTimeframe} disabled={loading} />
          <RefreshButton onClick={reload} refreshing={loading} />
        </div>
      }
    />
  )

  if (error) {
    return (
      <div className="page-content">
        {header}
        <EmptyState
          icon={<AlertCircle size={18} />}
          title="Couldn't load gaming activity"
          description={error}
          variant="muted"
        />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="page-content">
        {header}
        <TableSkeleton rows={6} />
      </div>
    )
  }

  // Tracking off: say so and stop. Switching it on is an admin's decision, so
  // there is nothing here to nudge — a member can't act on this screen at all.
  if (!data.enabled) {
    return (
      <div className="page-content">
        {header}
        <EmptyState
          icon={<Gamepad2 size={36} />}
          title="Gaming isn't being tracked here"
          description="This server doesn't record gaming activity, so there's nothing to show. Ask a server admin if you'd like it switched on."
        />
      </div>
    )
  }

  const overview = data.overview
  const nothingYet = !overview || overview.totalSessions === 0

  return (
    <div className="page-content">
      {header}

      <div className="space-y-8">
        {/* Right now — the reason to open this page at all. */}
        <GamingLive guildId={guildId} />

        {nothingYet ? (
          <EmptyState
            icon={<Gamepad2 size={36} />}
            title="No gaming recorded yet"
            description="Nothing has been picked up in this period. Play something with your Discord activity status visible and it'll show up here."
            variant="muted"
          />
        ) : (
          <>
            <CategorySection
              icon={<Gamepad2 size={14} />}
              title="At a glance"
              description={`This server's gaming over the ${data.window?.periodLabel ?? 'selected period'}.`}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile
                  icon={<Hourglass size={11} />}
                  label="Hours played"
                  value={formatHours(overview.totalSeconds)}
                  hint={`${overview.totalSessions.toLocaleString()} sessions`}
                />
                <StatTile
                  icon={<Users size={11} />}
                  label="Players"
                  value={overview.uniquePlayers.toLocaleString()}
                  hint={`${overview.activeWeek.toLocaleString()} active this week`}
                />
                <StatTile
                  icon={<Gamepad2 size={11} />}
                  label="Games played"
                  value={overview.uniqueGames.toLocaleString()}
                  hint={`${overview.currentlyPlaying} playing now`}
                />
                <StatTile
                  icon={<Timer size={11} />}
                  label="Typical session"
                  value={formatDuration(overview.avgSessionSeconds)}
                  hint={`longest ${formatDuration(overview.longestSeconds)}`}
                />
              </div>
            </CategorySection>

            <div className="grid gap-8 lg:grid-cols-2">
              <CategorySection
                icon={<Trophy size={14} />}
                title="Most played"
                description="What this server actually spends its evenings on."
              >
                <BarList
                  rows={games.slice(0, 10).map((g) => ({
                    key: g.gameKey,
                    label: g.gameName,
                    value: g.totalSeconds,
                    display: formatDuration(g.totalSeconds),
                    sub:
                      `${g.uniquePlayers} player${g.uniquePlayers === 1 ? '' : 's'}` +
                      (g.currentlyPlaying > 0 ? ` — ${g.currentlyPlaying} playing now` : ''),
                  }))}
                  empty="No games recorded in this period."
                />
              </CategorySection>

              <CategorySection
                icon={<Users size={14} />}
                title="Top players"
                description="Ranked by time played in this period."
              >
                <BarList
                  accent="#a855f7"
                  rows={players.slice(0, 10).map((p, i) => ({
                    key: p.userId,
                    label: displayName(p, anonymise, i + 1),
                    value: p.totalSeconds,
                    display: formatDuration(p.totalSeconds),
                    sub: p.favouriteGame ? `mostly ${p.favouriteGame}` : undefined,
                  }))}
                  empty="Nobody has been recorded playing in this period."
                />
              </CategorySection>
            </div>

            {squads.length > 0 && (
              <CategorySection
                icon={<Users size={14} />}
                title="Who to play with"
                description="Members who keep coming back to the same game. Grouped by what each of them plays most."
              >
                <div className="grid gap-3 md:grid-cols-2">
                  {squads.map((s) => (
                    <div
                      key={s.game}
                      className="rounded-xl border p-4"
                      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="truncate font-semibold text-foreground" title={s.game}>
                          {s.game}
                        </p>
                        <span className="shrink-0 text-xs" style={{ color: 'var(--text-3)' }}>
                          {s.players.length} regular{s.players.length === 1 ? '' : 's'}
                          {s.playingNow > 0 ? ` — ${s.playingNow} on now` : ''}
                        </span>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {s.players.slice(0, 10).map((p) => (
                          <span
                            key={p.userId}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                            style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                            title={`${formatDuration(p.favouriteSeconds)} in ${s.game}`}
                          >
                            {p.userName ?? 'Unknown member'}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CategorySection>
            )}

            {data.peaks && (data.peaks.peakHour != null || data.peaks.busiestWeekday != null) && (
              <CategorySection
                icon={<Clock size={14} />}
                title="When this server plays"
                description="Times are in your own timezone — turn up when everyone else does."
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatTile
                    icon={<Clock size={11} />}
                    label="Busiest hour"
                    value={data.peaks.peakHour == null ? '—' : hourLabel(data.peaks.peakHour)}
                    hint={
                      data.peaks.peakHourSeconds > 0
                        ? `${formatDuration(data.peaks.peakHourSeconds)} played`
                        : undefined
                    }
                  />
                  <StatTile
                    icon={<Clock size={11} />}
                    label="Busiest day"
                    value={
                      data.peaks.busiestWeekday == null
                        ? '—'
                        : WEEKDAY_LABELS[data.peaks.busiestWeekday]
                    }
                    hint={
                      data.peaks.busiestWeekdaySeconds > 0
                        ? `${formatDuration(data.peaks.busiestWeekdaySeconds)} played`
                        : undefined
                    }
                  />
                  <StatTile
                    icon={<Users size={11} />}
                    label="Weekend share"
                    value={`${Math.round(data.peaks.weekendShare * 100)}%`}
                    hint="of all playtime"
                  />
                </div>
              </CategorySection>
            )}

            {anonymise && (
              <p className="text-xs text-subtle">
                This server shows gaming statistics anonymously, so members appear as “Player 1,
                2, 3…” rather than by name.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
