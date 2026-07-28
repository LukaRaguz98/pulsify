'use client'

import { useCallback, useState, useSyncExternalStore } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Activity,
  CalendarDays,
  Clock,
  Flame,
  Gamepad2,
  GripVertical,
  Hourglass,
  Sparkles,
  Timer,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { BarList, LiveDot, StatTile, TrendBadge } from '@/components/dashboard/gaming/gaming-style'
import {
  WEEKDAY_LABELS,
  displayName,
  formatDuration,
  formatHours,
  sortGames,
} from '@/lib/gaming'
import type { GamingPayload } from '@/components/dashboard/gaming/GamingContent'

/**
 * The Gaming overview: an at-a-glance strip, then a grid of widgets the admin
 * can reorder.
 *
 * WHY THE ORDER IS PER-BROWSER. Widget arrangement is a reading preference, not
 * server configuration — two admins on the same server want different things at
 * the top, and storing it per guild would have them fighting over it. It lives
 * in localStorage, keyed by guild, and falls back to the default order whenever
 * the stored list no longer matches the widget set (which is what makes adding
 * a widget in a later release safe).
 */

const WIDGETS = [
  'currently-playing',
  'top-games',
  'top-players',
  'total-hours',
  'active-sessions',
  'trending-games',
  'weekly-highlights',
] as const

type WidgetKey = (typeof WIDGETS)[number]

function storageKey(guildId: string) {
  return `pulsify:gaming-widgets:${guildId}`
}

function parseOrder(raw: string | null): WidgetKey[] {
  if (!raw) return [...WIDGETS]
  try {
    const parsed = JSON.parse(raw) as string[]
    const valid = parsed.filter((k): k is WidgetKey => (WIDGETS as readonly string[]).includes(k))
    // Any widget added since the order was saved is appended rather than lost.
    const missing = WIDGETS.filter((k) => !valid.includes(k))
    return [...valid, ...missing]
  } catch {
    return [...WIDGETS]
  }
}

/**
 * localStorage read as an external store. Reading it in an effect and calling
 * setState would be a cascading render (and the project's lint rules reject
 * it); reading it in a `useState` initialiser would desync server and client
 * HTML. `useSyncExternalStore` is the sanctioned way to read a browser-only
 * value: the server snapshot is null, so SSR renders the default order and the
 * client swaps to the stored one during hydration.
 */
const NO_SUBSCRIBE = () => () => {}

function useStoredOrder(guildId: string): WidgetKey[] {
  const raw = useSyncExternalStore(
    NO_SUBSCRIBE,
    () => {
      try {
        return window.localStorage.getItem(storageKey(guildId))
      } catch {
        return null
      }
    },
    () => null,
  )
  return parseOrder(raw)
}

export function GamingOverview({
  data,
  loading,
  guildId,
}: {
  data: GamingPayload | null
  loading: boolean
  guildId: string
}) {
  const stored = useStoredOrder(guildId)
  // Drag results live in local state so the grid reorders instantly; the store
  // read above is only the starting point.
  const [dragged, setDragged] = useState<WidgetKey[] | null>(null)
  const order = dragged ?? stored

  const sensors = useSensors(
    // A small activation distance so clicking a link inside a widget doesn't
    // start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      setDragged((prev) => {
        const base = prev ?? stored
        const next = arrayMove(
          base,
          base.indexOf(active.id as WidgetKey),
          base.indexOf(over.id as WidgetKey),
        )
        try {
          window.localStorage.setItem(storageKey(guildId), JSON.stringify(next))
        } catch {
          // A private-mode browser refusing storage is not worth an error
          // toast; the arrangement simply doesn't persist.
        }
        return next
      })
    },
    [guildId, stored],
  )

  if (loading && !data) return <TableSkeleton rows={6} />
  if (!data) return null

  const { overview, games, players, trends, insights, peaks, daily, anonymise } = data

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

  return (
    <div className="space-y-8">
      <CategorySection
        icon={<Activity size={14} />}
        title="At a glance"
        description="The window you selected, summarised."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={<Hourglass size={14} />}
            label="Total played"
            value={formatHours(overview.totalSeconds)}
            hint={`${overview.totalSessions.toLocaleString()} sessions`}
          />
          <StatTile
            icon={<Users size={14} />}
            label="Players"
            value={overview.uniquePlayers.toLocaleString()}
            hint={`${overview.activeToday} today · ${overview.activeWeek} this week`}
          />
          <StatTile
            icon={<Gamepad2 size={14} />}
            label="Games"
            value={overview.uniqueGames.toLocaleString()}
            hint={`${data.newGames.length} new recently`}
          />
          <StatTile
            icon={<Timer size={14} />}
            label="Average session"
            value={formatDuration(overview.avgSessionSeconds)}
            hint={`longest ${formatDuration(overview.longestSeconds)}`}
          />
        </div>
      </CategorySection>

      <CategorySection
        icon={<GripVertical size={14} />}
        title="Widgets"
        description="Drag any card to rearrange. The order is remembered in this browser."
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={rectSortingStrategy}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {order.map((key) => (
                <SortableWidget key={key} id={key}>
                  {renderWidget(key, {
                    overview,
                    games,
                    players,
                    trends,
                    insights,
                    peaks,
                    daily,
                    anonymise,
                  })}
                </SortableWidget>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </CategorySection>
    </div>
  )
}

function SortableWidget({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 10 : undefined,
        background: 'var(--panel)',
        borderColor: 'var(--line-strong)',
      }}
      className="relative rounded-xl border"
    >
      <div
        className="rounded-xl"
        style={{ background: 'var(--panel)' }}
      >
        <button
          type="button"
          aria-label="Drag to reorder"
          className="absolute right-2 top-2 cursor-grab touch-none rounded-md p-1 active:cursor-grabbing"
          style={{ color: 'var(--text-3)' }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
        {children}
      </div>
    </div>
  )
}

type WidgetData = Pick<
  GamingPayload,
  'overview' | 'games' | 'players' | 'trends' | 'insights' | 'peaks' | 'daily' | 'anonymise'
>

function renderWidget(key: WidgetKey, d: WidgetData) {
  switch (key) {
    case 'currently-playing':
      return (
        <Widget icon={<LiveDot />} title="Currently playing">
          {d.overview.currentlyPlaying === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>
              Nobody is in a game right now.
            </p>
          ) : (
            <>
              <p className="text-3xl font-bold text-foreground">{d.overview.currentlyPlaying}</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>
                {d.overview.currentlyPlaying === 1 ? 'member is' : 'members are'} playing — open the
                Live tab to see who
              </p>
            </>
          )}
        </Widget>
      )

    case 'top-games':
      return (
        <Widget icon={<Gamepad2 size={14} />} title="Top games">
          <BarList
            empty="No games tracked yet."
            rows={sortGames(d.games, 'playtime')
              .slice(0, 5)
              .map((g) => ({
                key: g.gameKey,
                label: g.gameName,
                value: g.totalSeconds,
                display: formatDuration(g.totalSeconds),
                sub: `${g.uniquePlayers} player${g.uniquePlayers === 1 ? '' : 's'}`,
              }))}
          />
        </Widget>
      )

    case 'top-players':
      return (
        <Widget icon={<Trophy size={14} />} title="Top players">
          <BarList
            accent="#f59e0b"
            empty="No players tracked yet."
            rows={[...d.players]
              .sort((a, b) => b.totalSeconds - a.totalSeconds)
              .slice(0, 5)
              .map((p, i) => ({
                key: p.userId,
                label: displayName(p, d.anonymise, i + 1),
                value: p.totalSeconds,
                display: formatDuration(p.totalSeconds),
                sub: d.anonymise ? undefined : (p.favouriteGame ?? undefined),
              }))}
          />
        </Widget>
      )

    case 'total-hours':
      return (
        <Widget icon={<Hourglass size={14} />} title="Total gaming hours">
          <p className="text-3xl font-bold text-foreground">
            {formatHours(d.overview.totalSeconds)}
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>
            across {d.overview.totalSessions.toLocaleString()} sessions and{' '}
            {d.overview.uniqueGames} games
          </p>
          <p className="mt-3 text-xs" style={{ color: 'var(--text-3)' }}>
            Averaging {formatDuration(d.insights.avgDailySeconds)} on days with any activity.
          </p>
        </Widget>
      )

    case 'active-sessions':
      return (
        <Widget icon={<Activity size={14} />} title="Active sessions">
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Today" value={d.overview.activeToday.toLocaleString()} />
            <MiniStat label="This week" value={d.overview.activeWeek.toLocaleString()} />
            <MiniStat label="Longest" value={formatDuration(d.overview.longestSeconds)} />
            <MiniStat label="Average" value={formatDuration(d.overview.avgSessionSeconds)} />
          </div>
        </Widget>
      )

    case 'trending-games': {
      const rising = d.trends
        .filter((t) => t.direction === 'rising' || t.direction === 'new')
        .sort((a, b) => b.currentSeconds - a.currentSeconds)
        .slice(0, 5)
      return (
        <Widget icon={<TrendingUp size={14} />} title="Trending games">
          {rising.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>
              Nothing is climbing in this window.
            </p>
          ) : (
            <ul className="space-y-2">
              {rising.map((t) => (
                <li key={t.game.gameKey} className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {t.game.gameName}
                  </span>
                  <TrendBadge trend={t} />
                </li>
              ))}
            </ul>
          )}
        </Widget>
      )
    }

    case 'weekly-highlights': {
      const busiestDay = [...d.daily].sort((a, b) => b.totalSeconds - a.totalSeconds)[0]
      return (
        <Widget icon={<Sparkles size={14} />} title="Weekly highlights">
          <ul className="space-y-2.5 text-sm">
            <Highlight
              icon={<Flame size={13} />}
              label="Busiest day"
              value={
                busiestDay
                  ? `${busiestDay.day} — ${formatDuration(busiestDay.totalSeconds)}`
                  : 'no activity yet'
              }
            />
            <Highlight
              icon={<Clock size={13} />}
              label="Peak hour"
              value={
                d.peaks.peakHour == null
                  ? 'no activity yet'
                  : `${String(d.peaks.peakHour).padStart(2, '0')}:00`
              }
            />
            <Highlight
              icon={<CalendarDays size={13} />}
              label="Busiest weekday"
              value={
                d.peaks.busiestWeekday == null
                  ? 'no activity yet'
                  : WEEKDAY_LABELS[d.peaks.busiestWeekday]
              }
            />
            <Highlight
              icon={<Users size={13} />}
              label="Most social game"
              value={d.insights.mostSocialGame?.gameName ?? 'not enough data'}
            />
          </ul>
        </Widget>
      )
    }

    default:
      return null
  }
}

function Widget({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="p-4">
      <div
        className="mb-3 flex items-center gap-1.5 pr-6 text-[10px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--text-3)' }}
      >
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: 'var(--bg-2)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-bold text-foreground">{value}</p>
    </div>
  )
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
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0" style={{ color: 'var(--text-3)' }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs" style={{ color: 'var(--text-3)' }}>
          {label}
        </span>
        <span className="block truncate font-medium text-foreground">{value}</span>
      </span>
    </li>
  )
}
