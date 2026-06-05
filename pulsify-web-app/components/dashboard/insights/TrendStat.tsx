import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { Trend, TrendDirection } from '@/lib/insights'

/** Whether a movement in a given direction is good, bad or just informational. */
export type Sentiment = 'good' | 'bad' | 'neutral'

const SENTIMENT_COLOR: Record<Sentiment, string> = {
  good: '#10b981',
  bad: '#ef4444',
  neutral: 'var(--text-3)',
}

const DIRECTION_ICON: Record<TrendDirection, typeof TrendingUp> = {
  increasing: TrendingUp,
  decreasing: TrendingDown,
  stable: Minus,
}

/**
 * Resolve the sentiment of a trend given which direction is desirable for the
 * metric. `neutral` metrics (e.g. moderation actions) never read as good/bad.
 */
export function sentimentOf(trend: Trend, goodDirection: 'up' | 'down' | 'none'): Sentiment {
  if (goodDirection === 'none' || trend.direction === 'stable') return 'neutral'
  if (trend.direction === 'increasing') return goodDirection === 'up' ? 'good' : 'bad'
  return goodDirection === 'down' ? 'good' : 'bad'
}

/** Small pill showing trend direction + signed percentage. */
export function TrendBadge({ trend, sentiment }: { trend: Trend; sentiment: Sentiment }) {
  const Icon = DIRECTION_ICON[trend.direction]
  const color = SENTIMENT_COLOR[sentiment]
  const label = trend.isNew
    ? 'New'
    : trend.direction === 'stable'
      ? 'Stable'
      : `${trend.changePct > 0 ? '+' : ''}${trend.changePct}%`
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
      title={trend.isNew ? 'new activity vs the previous period' : `${trend.direction} vs previous period`}
    >
      <Icon size={11} />
      {label}
    </span>
  )
}

type Props = {
  label: string
  value: string
  sub?: string
  icon: React.ReactNode
  accent: string
  trend: Trend
  goodDirection: 'up' | 'down' | 'none'
  /** Suppress the trend pill — e.g. the 'all time' window has no prior period. */
  hideTrend?: boolean
}

/**
 * An engagement-overview metric: headline value, an accent icon chip and a
 * trend pill comparing this period to the one before it.
 */
export function TrendStat({ label, value, sub, icon, accent, trend, goodDirection, hideTrend }: Props) {
  const sentiment = sentimentOf(trend, goodDirection)
  return (
    <div
      className="insight-card rounded-xl border p-5 transition-all duration-150 hover:-translate-y-0.5"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}
        >
          {icon}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <p
          className="text-3xl font-bold tracking-tight"
          style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', color: 'var(--text)' }}
        >
          {value}
        </p>
        {!hideTrend && <TrendBadge trend={trend} sentiment={sentiment} />}
      </div>
      {sub && <p className="mt-1.5 text-xs text-subtle">{sub}</p>}
    </div>
  )
}
