'use client'

import { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import {
  CATEGORY_COLORS,
  CATEGORY_IDS,
  CATEGORY_LABELS,
  CONFIDENCE_COLORS,
  CONFIDENCE_LABELS,
  confidenceLabel as deriveConfidenceLabel,
  type ConfidenceLabel,
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

  // ── Detection performance (PULSIFY-41) ──────────────────────────────────────
  // Accuracy + false-positive + override metrics are driven by the explicit
  // moderator feedback signal where it exists, so they reflect human judgement
  // rather than guessing from status transitions.
  const perf = useMemo(() => {
    let confirmed = 0
    let falsePositives = 0
    let withFeedback = 0
    let successfulActions = 0
    let autoActions = 0
    const confidence: Record<ConfidenceLabel, number> = { low: 0, medium: 0, high: 0 }
    for (const e of events) {
      if (e.moderator_verdict === 'correct') { confirmed++; withFeedback++ }
      else if (e.moderator_verdict === 'incorrect') { falsePositives++; withFeedback++ }
      if (e.action_taken && e.action_taken !== 'none') {
        autoActions++
        const meta = e.action_meta as { error?: unknown } | null
        if (!meta || meta.error == null) successfulActions++
      }
      const band = (e.confidence_label as ConfidenceLabel | null) ?? deriveConfidenceLabel(e.confidence)
      confidence[band]++
    }
    const accuracy = withFeedback === 0 ? null : Math.round((confirmed / withFeedback) * 100)
    const overrideRate = withFeedback === 0 ? null : Math.round((falsePositives / withFeedback) * 100)
    return { confirmed, falsePositives, withFeedback, successfulActions, autoActions, accuracy, overrideRate, confidence }
  }, [events])

  const confidenceMax = Math.max(1, perf.confidence.low, perf.confidence.medium, perf.confidence.high)

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

      {/* Confidence distribution */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Confidence distribution</h3>
          <span className="text-[11px] text-subtle">{summary.total} detections</span>
        </div>
        <ul className="space-y-2">
          {(['high', 'medium', 'low'] as ConfidenceLabel[]).map((band) => (
            <li key={band} className="flex items-center gap-3">
              <span className="w-32 truncate text-xs" style={{ color: 'var(--text-2)' }}>{CONFIDENCE_LABELS[band]}</span>
              <div className="flex-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)', height: 8 }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(4, (perf.confidence[band] / confidenceMax) * 100)}%`,
                    background: CONFIDENCE_COLORS[band],
                  }}
                />
              </div>
              <span className="w-10 text-right font-mono text-[11px]" style={{ color: 'var(--text-3)' }}>
                {perf.confidence[band]}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Detection performance */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">Detection performance</h3>
          <p className="text-xs text-subtle">Accuracy is based on moderator feedback (correct vs false positive).</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricTile
            label="Accuracy"
            value={perf.accuracy === null ? '—' : `${perf.accuracy}%`}
            sub={perf.withFeedback === 0 ? 'Awaiting feedback' : `${perf.confirmed}/${perf.withFeedback} confirmed correct`}
          />
          <MetricTile
            label="Override rate"
            value={perf.overrideRate === null ? '—' : `${perf.overrideRate}%`}
            sub={`${perf.falsePositives} marked false positive`}
          />
        </div>
      </div>

      {/* Workload summary */}
      <div
        className="rounded-xl border p-5 lg:col-span-2"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">Workload &amp; throughput</h3>
          <p className="text-xs text-subtle">How Pulse Guard is performing across the events it has seen.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <MetricTile label="Total detections" value={summary.total} sub="All-time" />
          <MetricTile label="Pending review" value={summary.pending} sub="Waiting on moderators" />
          <MetricTile label="Auto-actions taken" value={perf.autoActions} sub="Deleted / warned / timed out" />
          <MetricTile
            label="Successful actions"
            value={perf.successfulActions}
            sub={`${perf.autoActions === 0 ? 0 : Math.round((perf.successfulActions / perf.autoActions) * 100)}% executed cleanly`}
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

