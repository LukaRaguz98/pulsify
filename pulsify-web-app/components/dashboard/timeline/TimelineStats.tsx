'use client'

import {
  Activity, CalendarDays, CalendarRange, Clock, History, Layers, Sunrise, UserCog, Boxes,
} from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import {
  CATEGORY_ACCENT,
  CATEGORY_LABELS,
  WEEKDAY_LABELS,
  busiestWindow,
  denseWeekdays,
  formatActor,
  moduleLabel,
  type TimelineActorCount,
  type TimelineCategory,
  type TimelineStats,
} from '@/lib/timeline'

/**
 * The statistics strip above the feed.
 *
 * Split into three named sections so it reads as a briefing rather than a wall
 * of tiles: how MUCH is happening (Activity at a glance), WHEN it happens
 * (Busiest periods), and WHO/WHAT is behind it (Contributors & coverage).
 * Everything here is derived from one RPC, over exactly the window the feed
 * below can show — so the numbers always describe the history you can scroll.
 */
export function TimelineStatsPanel({ stats }: { stats: TimelineStats }) {
  const window = busiestWindow(stats.hours)
  const weekdays = denseWeekdays(stats.weekdays)
  const peakWeekday = weekdays.indexOf(Math.max(...weekdays))
  const hasActivity = stats.total > 0

  return (
    <div className="space-y-6">
      {/* How much — the headline volume, from now back to the whole window. */}
      <CategorySection
        icon={<Activity size={14} />}
        title="Activity at a glance"
        description="How much is happening across the history this server's plan retains."
        helpId="timeline-stats"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={<Activity size={14} />} label="Today" value={stats.today.toLocaleString()} hint="since midnight" />
          <StatTile icon={<CalendarDays size={14} />} label="This week" value={stats.week.toLocaleString()} hint="last 7 days" />
          <StatTile icon={<CalendarRange size={14} />} label="This month" value={stats.month.toLocaleString()} hint="last 30 days" />
          <StatTile icon={<History size={14} />} label="All time" value={stats.total.toLocaleString()} hint="in the retained window" />
        </div>
      </CategorySection>

      {/* When — the server's rhythm: the hot part of the day, weekday and date. */}
      <CategorySection
        icon={<Clock size={14} />}
        title="Busiest periods"
        description="When this server actually changes, so you know where to look first."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            icon={<Clock size={14} />}
            label="Peak window"
            value={hasActivity && window ? window : '—'}
            hint={hasActivity ? 'most changes land here' : 'not enough history yet'}
          />
          <StatTile
            icon={<Sunrise size={14} />}
            label="Peak weekday"
            value={hasActivity && weekdays[peakWeekday] > 0 ? WEEKDAY_LABELS[peakWeekday] : '—'}
            hint={hasActivity && weekdays[peakWeekday] > 0 ? `${weekdays[peakWeekday].toLocaleString()} events` : 'not enough history yet'}
          />
          <StatTile
            icon={<CalendarRange size={14} />}
            label="Busiest day"
            value={stats.busiestDay ? formatDay(stats.busiestDay.day) : '—'}
            hint={stats.busiestDay ? `${stats.busiestDay.count.toLocaleString()} events` : 'not enough history yet'}
          />
        </div>
      </CategorySection>

      {/* Who & what — attribution and coverage, ranked. */}
      <CategorySection
        icon={<Layers size={14} />}
        title="Contributors & coverage"
        description="The people, modules and categories behind the activity."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <BreakdownCard
            icon={<UserCog size={13} />}
            title="Most active administrators"
            empty="No attributed changes yet."
            rows={stats.actors.slice(0, 5).map((a) => ({
              key: a.id,
              label: labelForActor(a),
              count: a.count,
              color: 'var(--p-1)',
            }))}
            total={stats.actors[0]?.count ?? 0}
          />
          <BreakdownCard
            icon={<Boxes size={13} />}
            title="Most modified modules"
            empty="No module activity yet."
            rows={stats.modules.slice(0, 5).map((m) => ({
              key: m.key,
              label: moduleLabel(m.key) ?? m.key,
              count: m.count,
              color: 'var(--p-1)',
            }))}
            total={stats.modules[0]?.count ?? 0}
          />
          <BreakdownCard
            icon={<Activity size={13} />}
            title="By category"
            empty="Nothing recorded yet."
            rows={stats.categories.slice(0, 5).map((c) => ({
              key: c.key,
              label: CATEGORY_LABELS[c.key as TimelineCategory] ?? c.key,
              count: c.count,
              color: CATEGORY_ACCENT[c.key as TimelineCategory] ?? 'var(--p-1)',
            }))}
            total={stats.categories[0]?.count ?? 0}
          />
        </div>
      </CategorySection>
    </div>
  )
}

function labelForActor(actor: TimelineActorCount): string {
  return formatActor({ id: actor.id, name: actor.name, username: actor.username })
}

/** "18 Jul" — compact enough for a tile, unambiguous enough to act on. */
function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function StatTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
        {icon}
        {label}
      </div>
      <p className="mt-2 truncate text-xl font-bold text-foreground" title={value}>{value}</p>
      <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-3)' }}>{hint}</p>
    </div>
  )
}

type BreakdownRow = { key: string; label: string; count: number; color: string }

/**
 * A ranked list with proportional bars. Bars are scaled to the leader rather
 * than the total, so a long tail stays legible instead of collapsing into a
 * row of invisible slivers.
 */
function BreakdownCard({
  icon,
  title,
  rows,
  total,
  empty,
}: {
  icon: React.ReactNode
  title: string
  rows: BreakdownRow[]
  total: number
  empty: string
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
        {icon}
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs" style={{ color: 'var(--text-3)' }}>{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((row) => (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-foreground" title={row.label}>{row.label}</span>
                <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {row.count.toLocaleString()}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${total > 0 ? Math.max(4, (row.count / total) * 100) : 0}%`,
                    background: row.color,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
