'use client'

import type { ReactNode } from 'react'
import { TrendingDown, TrendingUp, Minus, Sparkles } from 'lucide-react'
import type { GameTrend } from '@/lib/gaming'

/**
 * Shared visual language for Gaming Analytics (PULSIFY-64).
 *
 * The module renders the same three shapes over and over — a stat tile, a
 * ranked bar list, and a trend badge — across six tabs. Defining them once is
 * what keeps "hours played" looking identical whether you meet it on the
 * overview, inside a game, or on a player's profile.
 */

export function StatTile({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: ReactNode
  label: string
  value: string
  hint?: string
  accent?: string
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest"
        style={{ color: accent ?? 'var(--text-3)' }}
      >
        {icon}
        {label}
      </div>
      <p className="mt-2 truncate text-xl font-bold text-foreground" title={value}>
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-3)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

export type BarRow = {
  key: string
  label: string
  value: number
  display: string
  sub?: string
  onClick?: () => void
}

/**
 * A ranked list with proportional bars, scaled to the LEADER rather than the
 * total. Scaling to the total would collapse a long tail into invisible
 * slivers — the point of the bar is comparison between neighbours, not each
 * row's share of everything.
 */
export function BarList({
  rows,
  accent = 'var(--p-1)',
  empty,
}: {
  rows: BarRow[]
  accent?: string
  empty: string
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm" style={{ color: 'var(--text-3)' }}>
        {empty}
      </p>
    )
  }

  const max = Math.max(...rows.map((r) => r.value), 1)

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => {
        const pct = Math.max(2, Math.round((row.value / max) * 100))
        const interactive = typeof row.onClick === 'function'
        return (
          <li key={row.key}>
            <button
              type="button"
              onClick={row.onClick}
              disabled={!interactive}
              className="w-full text-left disabled:cursor-default"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className="truncate text-sm font-medium text-foreground"
                  title={row.label}
                >
                  {row.label}
                </span>
                <span className="shrink-0 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                  {row.display}
                </span>
              </div>
              <div
                className="mt-1.5 h-1.5 overflow-hidden rounded-full"
                style={{ background: 'var(--bg-2)' }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: accent }}
                />
              </div>
              {row.sub && (
                <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {row.sub}
                </p>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

const TREND_STYLE: Record<
  GameTrend['direction'],
  { icon: ReactNode; color: string; background: string; label: (t: GameTrend) => string }
> = {
  rising: {
    icon: <TrendingUp size={11} />,
    color: '#10b981',
    background: 'rgba(16,185,129,0.12)',
    label: (t) => `+${Math.round((t.changeRatio ?? 0) * 100)}%`,
  },
  falling: {
    icon: <TrendingDown size={11} />,
    color: '#f87171',
    background: 'rgba(248,113,113,0.12)',
    label: (t) => `${Math.round((t.changeRatio ?? 0) * 100)}%`,
  },
  steady: {
    icon: <Minus size={11} />,
    color: 'var(--text-3)',
    background: 'var(--bg-2)',
    label: () => 'steady',
  },
  new: {
    icon: <Sparkles size={11} />,
    color: '#a855f7',
    background: 'rgba(168,85,247,0.12)',
    label: () => 'new',
  },
}

/**
 * Direction of travel for one game over the window. The percentage is
 * deliberately absent for `new` — a game with no previous activity has no
 * meaningful growth rate, and printing "+∞%" would put every first-time game
 * permanently at the top of the rising list.
 */
export function TrendBadge({ trend }: { trend: GameTrend }) {
  const style = TREND_STYLE[trend.direction]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ color: style.color, background: style.background }}
    >
      {style.icon}
      {style.label(trend)}
    </span>
  )
}

/** A live "playing now" dot — the one thing on the page that is happening. */
export function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span
        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
        style={{ background: '#10b981' }}
      />
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: '#10b981' }} />
    </span>
  )
}

/** Tab button, matching the invite/members tab strip. */
export function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
      style={active ? { background: 'var(--p-soft)', color: 'var(--p-1)' } : { color: 'var(--text-2)' }}
    >
      {icon}
      {label}
    </button>
  )
}

/**
 * Heatmap cell colour. A single hue with varying alpha rather than a rainbow
 * ramp: the reader is comparing intensity, and a multi-hue scale makes them
 * decode a legend before they can do that. Empty cells stay visibly empty.
 */
export function heatColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return 'var(--bg-2)'
  // Square root keeps quiet hours distinguishable from dead ones — with a
  // linear ramp a single busy evening flattens the rest of the week to black.
  const intensity = Math.sqrt(value / max)
  return `rgba(168,85,247,${(0.12 + intensity * 0.78).toFixed(3)})`
}

/** "14:00" — hour labels for the heatmap axis. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** Relative "2h ago" for last-seen columns. */
export function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - Date.parse(iso)
  if (!Number.isFinite(diff)) return 'never'
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}
