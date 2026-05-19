'use client'

import { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import {
  CATEGORY_COLORS,
  CATEGORY_IDS,
  CATEGORY_LABELS,
} from '@/lib/ai-moderation'
import type { AIModerationEventRow } from '@/app/api/guilds/[guildId]/ai-moderation/events/route'
import { EmptyState } from '@/components/ui/empty-state'

type Props = {
  events: AIModerationEventRow[]
  summary: {
    total: number
    last24h: number
    last7d: number
    pending: number
    autoActions: number
    topCategoryCounts: Map<string, number>
  }
}

const DAYS_WINDOW = 14

export function AIModerationAnalytics({ events, summary }: Props) {
  const daily = useMemo(() => buildDailyBuckets(events, DAYS_WINDOW), [events])
  const dailyMax = useMemo(() => Math.max(1, ...daily.map((d) => d.count)), [daily])

  const categoryRows = useMemo(() => {
    return CATEGORY_IDS.map((id) => ({
      id,
      label: CATEGORY_LABELS[id],
      count: summary.topCategoryCounts.get(id) ?? 0,
      color: CATEGORY_COLORS[id],
    }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count)
  }, [summary.topCategoryCounts])

  const categoryMax = useMemo(() => Math.max(1, ...categoryRows.map((c) => c.count)), [categoryRows])

  const reviewed = events.filter((e) => e.status === 'resolved' || e.status === 'dismissed').length
  const dismissed = events.filter((e) => e.status === 'dismissed').length
  const falsePositiveRate = reviewed === 0 ? 0 : Math.round((dismissed / reviewed) * 100)

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 size={36} />}
        title="Analytics will appear once events accumulate"
        description="Run a few test analyses or wait for live detections to start populating the charts."
      />
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Daily volume */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Volume — last {DAYS_WINDOW} days</h3>
          <span className="text-[11px] text-subtle">{summary.last7d} in last 7d</span>
        </div>
        <div className="flex items-end gap-1.5" style={{ height: 160 }}>
          {daily.map((d) => (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t-md"
                title={`${d.date}: ${d.count}`}
                style={{
                  height: `${(d.count / dailyMax) * 100}%`,
                  minHeight: d.count > 0 ? 2 : 0,
                  background: 'linear-gradient(180deg, var(--p-1), var(--p-2))',
                  opacity: d.count > 0 ? 1 : 0.15,
                }}
              />
              <span className="text-[9px] font-mono" style={{ color: 'var(--text-3)' }}>
                {d.shortLabel}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Category breakdown */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Category breakdown</h3>
          <span className="text-[11px] text-subtle">{categoryRows.length} active</span>
        </div>
        {categoryRows.length === 0 ? (
          <p className="py-8 text-center text-xs text-subtle">
            No category hits yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {categoryRows.map((c) => (
              <li key={c.id} className="flex items-center gap-3">
                <span className="w-32 truncate text-xs" style={{ color: 'var(--text-2)' }}>{c.label}</span>
                <div className="flex-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)', height: 8 }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(4, (c.count / categoryMax) * 100)}%`,
                      background: c.color,
                    }}
                  />
                </div>
                <span className="w-10 text-right font-mono text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {c.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Workload summary */}
      <div
        className="rounded-xl border p-5 lg:col-span-2"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">Workload &amp; signal quality</h3>
          <p className="text-xs text-subtle">How the Pulse Guard is performing across the events it has seen.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <MetricTile label="Total events" value={summary.total} sub="All-time" />
          <MetricTile label="Pending review" value={summary.pending} sub="Waiting on moderators" />
          <MetricTile label="Auto-actions taken" value={summary.autoActions} sub="Deleted / warned / timed out" />
          <MetricTile
            label="Dismiss rate"
            value={`${falsePositiveRate}%`}
            sub={`${dismissed} / ${reviewed} reviewed dismissed`}
          />
        </div>
      </div>
    </div>
  )
}

function MetricTile({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number
  sub: string
}) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
    >
      <p className="text-[11px] uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold text-foreground">{value}</p>
      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{sub}</p>
    </div>
  )
}

function buildDailyBuckets(events: AIModerationEventRow[], days: number) {
  const now = new Date()
  const buckets: { date: string; shortLabel: string; count: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    d.setHours(0, 0, 0, 0)
    const iso = d.toISOString().slice(0, 10)
    buckets.push({
      date: iso,
      shortLabel: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
      count: 0,
    })
  }
  // Use a Map for O(1) lookups while filling buckets.
  const byDate = new Map(buckets.map((b) => [b.date, b]))
  for (const e of events) {
    const d = e.created_at.slice(0, 10)
    const b = byDate.get(d)
    if (b) b.count++
  }
  return buckets
}

