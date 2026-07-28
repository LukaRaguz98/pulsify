'use client'

import { useMemo } from 'react'
import { CalendarDays, Clock, Flame, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { UpgradePrompt } from '@/components/billing/UpgradePrompt'
import { StatTile, TrendBadge, heatColor, hourLabel } from '@/components/dashboard/gaming/gaming-style'
import {
  WEEKDAY_LABELS,
  averageConcurrent,
  denseHeatmap,
  formatDuration,
  formatHours,
} from '@/lib/gaming'
import type { GamingPayload } from '@/components/dashboard/gaming/GamingContent'

/**
 * Trends, heatmaps and community insights.
 *
 * Every number here is explicitly scoped to the selected window, because a
 * window-split trend is meaningless without knowing what was split (see
 * computeGameTrends). The headings say so rather than leaving the reader to
 * assume "all time".
 */
export function GamingTrends({
  data,
  loading,
}: {
  data: GamingPayload | null
  loading: boolean
}) {
  const grid = useMemo(() => denseHeatmap(data?.heatmap ?? []), [data?.heatmap])
  const heatMax = useMemo(() => Math.max(...grid.flat(), 0), [grid])

  if (loading && !data) return <TableSkeleton rows={8} />
  if (!data) return null

  // Trends, heatmaps and peaks are the paid half of the module — the API sends
  // them empty rather than partial, so this is one honest locked state instead
  // of charts with holes in them.
  if (!data.advanced) {
    return (
      <UpgradePrompt
        requiredPlan={data.requiredPlan ?? 'pro'}
        feature="Gaming trends & heatmaps"
        description="See which games are gaining and losing ground, when your server actually sits down to play, and how the week is shaped."
      />
    )
  }

  if (data.overview.totalSessions === 0) {
    return (
      <EmptyState
        icon={<TrendingUp size={18} />}
        title="Not enough activity for trends"
        description="Trends need at least a few sessions to compare. Check back once members have been playing for a while."
      />
    )
  }

  const rising = data.trends
    .filter((t) => t.direction === 'rising')
    .sort((a, b) => (b.changeRatio ?? 0) - (a.changeRatio ?? 0))
    .slice(0, 8)

  const falling = data.trends
    .filter((t) => t.direction === 'falling')
    .sort((a, b) => (a.changeRatio ?? 0) - (b.changeRatio ?? 0))
    .slice(0, 8)

  const concurrent = averageConcurrent(data.overview.totalSeconds, data.window.days ?? 30)

  return (
    <div className="space-y-8">
      <CategorySection
        icon={<Clock size={14} />}
        title="When this server plays"
        description={`Peaks over ${data.window.periodLabel}, in ${data.window.timezone}.`}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={<Clock size={14} />}
            label="Peak hour"
            value={data.peaks.peakHour == null ? '—' : hourLabel(data.peaks.peakHour)}
            hint={
              data.peaks.peakHour == null
                ? undefined
                : `${formatHours(data.peaks.peakHourSeconds)} played`
            }
          />
          <StatTile
            icon={<CalendarDays size={14} />}
            label="Busiest weekday"
            value={
              data.peaks.busiestWeekday == null ? '—' : WEEKDAY_LABELS[data.peaks.busiestWeekday]
            }
            hint={
              data.peaks.busiestWeekday == null
                ? undefined
                : `${formatHours(data.peaks.busiestWeekdaySeconds)} played`
            }
          />
          <StatTile
            icon={<Flame size={14} />}
            label="Weekend share"
            value={`${Math.round(data.peaks.weekendShare * 100)}%`}
            hint="of all playtime"
          />
          <StatTile
            icon={<Users size={14} />}
            label="Average concurrent"
            value={concurrent.toFixed(2)}
            hint="players, averaged over the window"
          />
        </div>
      </CategorySection>

      <CategorySection
        icon={<CalendarDays size={14} />}
        title="Activity heatmap"
        description="Playtime by hour and weekday. Darker means busier; empty cells mean nobody was playing."
      >
        <div
          className="overflow-x-auto rounded-xl border p-4"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <div className="min-w-[640px]">
            <div className="mb-1 flex gap-0.5 pl-10">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="flex-1 text-center text-[9px]"
                  style={{ color: 'var(--text-3)' }}
                >
                  {h % 3 === 0 ? h : ''}
                </div>
              ))}
            </div>
            {grid.map((row, weekday) => (
              <div key={weekday} className="mb-0.5 flex items-center gap-0.5">
                <div
                  className="w-10 shrink-0 text-[10px] font-semibold"
                  style={{ color: 'var(--text-3)' }}
                >
                  {WEEKDAY_LABELS[weekday]}
                </div>
                {row.map((seconds, hour) => (
                  <div
                    key={hour}
                    className="h-6 flex-1 rounded-sm"
                    title={`${WEEKDAY_LABELS[weekday]} ${hourLabel(hour)} — ${formatDuration(seconds)}`}
                    style={{ background: heatColor(seconds, heatMax) }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </CategorySection>

      <div className="grid gap-6 lg:grid-cols-2">
        <CategorySection
          icon={<TrendingUp size={14} />}
          title="Gaining popularity"
          description="Games played more in the recent half of the window than the older half."
        >
          <TrendList
            rows={rising}
            empty="Nothing is climbing in this window."
          />
        </CategorySection>

        <CategorySection
          icon={<TrendingDown size={14} />}
          title="Losing popularity"
          description="Games played less than they were earlier in the window."
        >
          <TrendList rows={falling} empty="Nothing is falling off in this window." />
        </CategorySection>
      </div>

      <CategorySection
        icon={<Users size={14} />}
        title="Community insights"
        description="What the numbers say about how this server plays together."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={<Users size={14} />}
            label="Games per member"
            value={data.insights.avgGamesPerMember.toFixed(1)}
            hint="on average"
          />
          <StatTile
            icon={<Clock size={14} />}
            label="Daily playtime"
            value={formatDuration(data.insights.avgDailySeconds)}
            hint="on days with activity"
          />
          <StatTile
            icon={<Flame size={14} />}
            label="Game diversity"
            value={`${Math.round(data.insights.gameDiversity * 100)}%`}
            hint="0% = one game, 100% = evenly spread"
          />
          <StatTile
            icon={<Users size={14} />}
            label="Returning players"
            value={String(data.insights.returningPlayers)}
            hint={`${data.insights.newlyActivePlayers} newly active`}
          />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <InsightCard
            label="Most social game"
            value={data.insights.mostSocialGame?.gameName ?? 'not enough data'}
            explain="Highest ratio of different players to sessions — the game most of the server keeps coming back to."
          />
          <InsightCard
            label="Most committed game"
            value={data.insights.mostCommittedGame?.gameName ?? 'not enough data'}
            explain="Longest average session. Discord reports a game name, not a game mode, so this measures dedication rather than competitiveness."
          />
          <InsightCard
            label="Inactive gamers"
            value={String(data.insights.inactivePlayers)}
            explain="Members with tracked sessions who haven't played in over a month."
          />
        </div>
      </CategorySection>
    </div>
  )
}

function TrendList({
  rows,
  empty,
}: {
  rows: GamingPayload['trends']
  empty: string
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm" style={{ color: 'var(--text-3)' }}>
        {empty}
      </p>
    )
  }
  return (
    <ul className="space-y-2">
      {rows.map((t) => (
        <li
          key={t.game.gameKey}
          className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5"
          style={{ background: 'var(--panel)' }}
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{t.game.gameName}</p>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              {formatDuration(t.currentSeconds)} recently · {formatDuration(t.previousSeconds)}{' '}
              before
            </p>
          </div>
          <TrendBadge trend={t} />
        </li>
      ))}
    </ul>
  )
}

function InsightCard({
  label,
  value,
  explain,
}: {
  label: string
  value: string
  explain: string
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <p
        className="text-[10px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--text-3)' }}
      >
        {label}
      </p>
      <p className="mt-1.5 truncate font-bold text-foreground" title={value}>
        {value}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
        {explain}
      </p>
    </div>
  )
}
