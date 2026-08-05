'use client'

import { useState } from 'react'
import {
  Activity,
  CalendarDays,
  Clock,
  Flame,
  Gamepad2,
  Hourglass,
  LineChart,
  Sparkles,
  Timer,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { UpgradePrompt } from '@/components/billing/UpgradePrompt'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { RankedList } from '@/components/dashboard/RankedList'
import { ChartCard } from '@/components/dashboard/charts/ChartCard'
import { ToggleableChart } from '@/components/dashboard/charts/ToggleableChart'
import { LiveDot, TrendBadge } from '@/components/dashboard/gaming/gaming-style'
import { GamingPlayerProfile } from '@/components/dashboard/gaming/GamingPlayerProfile'
import { LeaderboardLink } from '@/components/dashboard/LeaderboardLink'
import {
  WEEKDAY_LABELS,
  displayName,
  formatDuration,
  formatHours,
  sortGames,
  type PlayerStat,
} from '@/lib/gaming'
import type { GamingPayload } from '@/components/dashboard/gaming/GamingContent'

/**
 * The Gaming overview.
 *
 * Built from the same pieces as every other analytics view in the dashboard —
 * CategorySection → StatsCard row → charts → ranked lists — rather than the
 * module's own card language. It used to be a grid of drag-to-reorder widgets,
 * which put a headline number, two ranked lists and a live counter side by side
 * at the same visual weight: nothing led, everything competed, and the module
 * looked unlike the rest of Analytics. The order is now deliberate and reads
 * top-down: how much, over time, by whom, and finally the patterns.
 *
 * (The per-browser widget arrangement went with it. Reordering only mattered
 * because no card was more important than another, which was the actual bug.)
 */
export function GamingOverview({
  data,
  loading,
  guildId,
  tz,
  onOpenTab,
}: {
  data: GamingPayload | null
  loading: boolean
  guildId: string
  tz: string
  /** Jump to a sibling tab — the overview summarises what they hold. */
  onOpenTab?: (tab: 'games' | 'live') => void
}) {
  // The per-member profile, opened from the "Top players" list — the ranking
  // itself lives on the Leaderboards page now.
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerStat | null>(null)

  if (loading && !data) return <TableSkeleton rows={6} />
  if (!data) return null

  const { overview, games, players, trends, insights, peaks, daily, anonymise } = data
  const period = data.window.periodLabel

  if (overview.totalSessions === 0) {
    return (
      <EmptyState
        icon={<Gamepad2 size={18} />}
        title="No gaming activity tracked yet"
        description={
          data.enabled
            ? 'As soon as members start playing something Discord can see, their sessions appear here. Members who hide their activity in Discord are never recorded.'
            : 'Turn on gaming tracking to start recording play sessions from Discord presence.'
        }
      />
    )
  }

  const topGames = sortGames(games, 'playtime').slice(0, 6)
  const topPlayers = [...players].sort((a, b) => b.totalSeconds - a.totalSeconds).slice(0, 6)
  const playerById = new Map(players.map((p) => [p.userId, p]))
  const rising = trends
    .filter((t) => t.direction === 'rising' || t.direction === 'new')
    .sort((a, b) => b.currentSeconds - a.currentSeconds)
    .slice(0, 6)
  const busiestDay = [...daily].sort((a, b) => b.totalSeconds - a.totalSeconds)[0]

  return (
    <div className="space-y-8">
      {/* ── The headline numbers ─────────────────────────────────────────── */}
      <CategorySection
        icon={<Activity size={14} />}
        title="At a glance"
        description={`Play activity across ${period.toLowerCase()}.`}
        action={
          overview.currentlyPlaying > 0 && onOpenTab ? (
            <button
              type="button"
              onClick={() => onOpenTab('live')}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <LiveDot />
              {overview.currentlyPlaying} playing now — see who
            </button>
          ) : undefined
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            label="Time played"
            value={formatHours(overview.totalSeconds)}
            sub={`${overview.totalSessions.toLocaleString()} sessions`}
            icon={<Hourglass size={16} />}
            accent="var(--p-1)"
          />
          <StatsCard
            label="Players"
            value={overview.uniquePlayers}
            sub={`${overview.activeToday} today · ${overview.activeWeek} this week`}
            icon={<Users size={16} />}
            accent="var(--cyan)"
          />
          <StatsCard
            label="Games"
            value={overview.uniqueGames}
            sub={data.newGames.length > 0 ? `${data.newGames.length} new recently` : 'None new recently'}
            icon={<Gamepad2 size={16} />}
            accent="var(--amber)"
          />
          <StatsCard
            label="Average session"
            value={formatDuration(overview.avgSessionSeconds)}
            sub={`Longest ${formatDuration(overview.longestSeconds)}`}
            icon={<Timer size={16} />}
            accent="var(--green)"
          />
        </div>
      </CategorySection>

      {/* ── The same totals, over time ───────────────────────────────────── */}
      <CategorySection
        icon={<LineChart size={14} />}
        title="Over time"
        description="Daily play time, and how many members and sessions produced it."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <ToggleableChart
            title="Time played"
            subtitle={`Hours in game per day · ${period}`}
            icon={<Hourglass size={15} />}
            defaultKind="bar"
            data={daily}
            xKey="day"
            series={[{ key: 'totalSeconds', name: 'Time played', color: 'var(--p-1)' }]}
            xTickFormatter={dayTick}
            yTickFormatter={(v) => formatHours(v)}
            tooltipValueFormatter={(v) => formatDuration(v)}
            tooltipLabelFormatter={dayTooltip}
          />
          <ToggleableChart
            title="Players & sessions"
            subtitle={`Distinct members and sessions per day · ${period}`}
            icon={<Users size={15} />}
            defaultKind="line"
            data={daily}
            xKey="day"
            series={[
              { key: 'uniquePlayers', name: 'Players', color: 'var(--cyan)' },
              { key: 'totalSessions', name: 'Sessions', color: 'var(--amber)' },
            ]}
            xTickFormatter={dayTick}
            tooltipLabelFormatter={dayTooltip}
            showLegend
          />
        </div>
      </CategorySection>

      {/* ── Who and what the time went to ────────────────────────────────── */}
      <CategorySection
        icon={<Trophy size={14} />}
        title="Most played"
        description="The games this server sinks its time into, and the members behind it."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartCard
            title="Top games"
            subtitle={`By time played · ${period}`}
            icon={<Gamepad2 size={15} />}
            disableLandscape
            action={
              onOpenTab ? (
                <button
                  type="button"
                  onClick={() => onOpenTab('games')}
                  className="text-xs font-medium transition-colors"
                  style={{ color: 'var(--p-1)' }}
                >
                  All games
                </button>
              ) : undefined
            }
          >
            <RankedList
              items={topGames.map((g) => ({
                id: g.gameKey,
                label: g.gameName,
                value: g.totalSeconds,
              }))}
              valueFormatter={(v) => formatDuration(v)}
              subFormatter={(item) => {
                const g = topGames.find((x) => x.gameKey === item.id)
                if (!g) return undefined
                const players = `${g.uniquePlayers} player${g.uniquePlayers === 1 ? '' : 's'}`
                return g.currentlyPlaying > 0 ? `${players} · ${g.currentlyPlaying} playing now` : players
              }}
              emptyText="No games tracked in this window."
            />
          </ChartCard>

          <ChartCard
            title="Top players"
            subtitle={`By time played · ${period}`}
            icon={<Trophy size={15} />}
            disableLandscape
            action={<LeaderboardLink guildId={guildId} board="gaming" variant="inline" label="Full board" />}
          >
            <RankedList
              barColor="var(--amber)"
              items={topPlayers.map((p, i) => ({
                id: p.userId,
                label: displayName(p, anonymise, i + 1),
                value: p.totalSeconds,
              }))}
              valueFormatter={(v) => formatDuration(v)}
              subFormatter={(item) =>
                anonymise ? undefined : (playerById.get(item.id)?.favouriteGame ?? undefined)
              }
              // Anonymised statistics hide identity, so there is no profile to open.
              onSelect={
                anonymise
                  ? undefined
                  : (id) => {
                      const p = playerById.get(id)
                      if (p) setSelectedPlayer(p)
                    }
              }
              emptyText="No players tracked in this window."
            />
          </ChartCard>
        </div>
      </CategorySection>

      {/* ── The shape of the week (paid half of the module) ──────────────── */}
      <CategorySection
        icon={<Sparkles size={14} />}
        title="Patterns"
        description="Which games are gaining ground, and when this server actually plays."
      >
        {!data.advanced ? (
          <UpgradePrompt
            requiredPlan={data.requiredPlan ?? 'pro'}
            feature="Gaming trends & patterns"
            description="See which games are climbing, when your server sits down to play, and how the week is shaped."
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard
              title="Trending games"
              subtitle={`Gaining ground within ${period.toLowerCase()}`}
              icon={<TrendingUp size={15} />}
              disableLandscape
            >
              {rising.length === 0 ? (
                <p className="py-2 text-sm text-subtle">Nothing is climbing in this window.</p>
              ) : (
                <ul className="space-y-2.5">
                  {rising.map((t) => (
                    <li key={t.game.gameKey} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-muted-foreground">
                        {t.game.gameName}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-xs text-foreground">
                          {formatDuration(t.currentSeconds)}
                        </span>
                        <TrendBadge trend={t} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ChartCard>

            <ChartCard
              title="Highlights"
              subtitle={`The week's shape · ${period}`}
              icon={<Flame size={15} />}
              disableLandscape
            >
              <ul className="space-y-2.5">
                <Highlight
                  icon={<Flame size={13} />}
                  label="Busiest day"
                  value={
                    busiestDay && busiestDay.totalSeconds > 0
                      ? `${busiestDay.day} — ${formatDuration(busiestDay.totalSeconds)}`
                      : 'No activity yet'
                  }
                />
                <Highlight
                  icon={<Clock size={13} />}
                  label="Peak hour"
                  value={
                    peaks.peakHour == null
                      ? 'No activity yet'
                      : `${String(peaks.peakHour).padStart(2, '0')}:00 — ${formatDuration(peaks.peakHourSeconds)}`
                  }
                />
                <Highlight
                  icon={<CalendarDays size={13} />}
                  label="Busiest weekday"
                  value={
                    peaks.busiestWeekday == null
                      ? 'No activity yet'
                      : `${WEEKDAY_LABELS[peaks.busiestWeekday]} · ${Math.round(peaks.weekendShare * 100)}% at weekends`
                  }
                />
                <Highlight
                  icon={<Users size={13} />}
                  label="Most social game"
                  value={insights.mostSocialGame?.gameName ?? 'Not enough data'}
                />
                <Highlight
                  icon={<Hourglass size={13} />}
                  label="Daily average"
                  value={`${formatDuration(insights.avgDailySeconds)} on days with activity`}
                />
              </ul>
            </ChartCard>
          </div>
        )}
      </CategorySection>

      {selectedPlayer && (
        <GamingPlayerProfile
          guildId={guildId}
          tz={tz}
          timeframe={data.window.timeframe}
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  )
}

/** "2026-08-05" → "08-05"; the year is the same across any window we chart. */
function dayTick(value: string): string {
  return typeof value === 'string' && value.length >= 10 ? value.slice(5) : String(value)
}

function dayTooltip(value: string): string {
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function Highlight({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="shrink-0 text-subtle">{icon}</span>
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-xs font-medium text-foreground" title={value}>
        {value}
      </span>
    </li>
  )
}
