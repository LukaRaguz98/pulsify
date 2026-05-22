'use client'

import { useMemo } from 'react'
import {
  Activity,
  CheckCircle2,
  XCircle,
  CircleSlash,
  TrendingUp,
  Loader2,
  BarChart3,
} from 'lucide-react'
import {
  TIMEFRAMES,
  formatBucketLabel,
  timeframeSince,
  timeframeBucket,
  type Timeframe,
} from '@/lib/analytics'
import { ToggleableChart } from '@/components/dashboard/charts/ToggleableChart'
import { ChartCard } from '@/components/dashboard/charts/ChartCard'
import { RankedList, type RankedItem } from '@/components/dashboard/RankedList'
import { EmptyState } from '@/components/ui/empty-state'
import type {
  AutomationAnalytics as AutomationAnalyticsData,
  AutomationTrendPoint,
} from '@/app/api/guilds/[guildId]/automations/analytics/route'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// The trends RPC only returns buckets that have runs, so a server with activity
// on one or two days renders as a couple of stranded points. Fill every
// hour/day in the window with zeros so the trend reads as a proper time series.
function fillTrend(trends: AutomationTrendPoint[], timeframe: Timeframe): AutomationTrendPoint[] {
  if (timeframe === 'all') {
    return [...trends].sort((a, b) => a.bucket.localeCompare(b.bucket))
  }
  const stepMs = timeframeBucket(timeframe) === 'hour' ? HOUR_MS : DAY_MS
  const since = timeframeSince(timeframe)
  if (!since) return trends
  const start = Math.floor(new Date(since).getTime() / stepMs) * stepMs
  const now = Date.now()
  const byBucket = new Map(
    trends.map((t) => [Math.floor(new Date(t.bucket).getTime() / stepMs) * stepMs, t]),
  )
  const out: AutomationTrendPoint[] = []
  for (let t = start; t <= now; t += stepMs) {
    out.push(byBucket.get(t) ?? { bucket: new Date(t).toISOString(), total: 0, success: 0, failed: 0 })
  }
  return out
}

type Props = {
  data: AutomationAnalyticsData | null
  loading: boolean
  timeframe: Timeframe
  onTimeframeChange: (tf: Timeframe) => void
}

export function AutomationAnalytics({ data, loading, timeframe, onTimeframeChange }: Props) {
  const stats = useMemo(() => data?.stats ?? [], [data])

  const totals = useMemo(() => {
    let total = 0
    let success = 0
    let failed = 0
    let skipped = 0
    for (const s of stats) {
      total += s.total
      success += s.success
      failed += s.failed
      skipped += s.skipped
    }
    const rate = total > 0 ? Math.round((success / total) * 100) : 0
    return { total, success, failed, skipped, rate }
  }, [stats])

  const mostActive: RankedItem[] = useMemo(
    () =>
      stats
        .map((s) => ({ id: s.automation_id ?? s.automation_name ?? '?', label: s.automation_name ?? 'Workflow', value: s.total }))
        .filter((i) => i.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
    [stats],
  )

  const failures: RankedItem[] = useMemo(
    () =>
      stats
        .filter((s) => s.failed > 0)
        .map((s) => ({ id: s.automation_id ?? s.automation_name ?? '?', label: s.automation_name ?? 'Workflow', value: s.failed }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
    [stats],
  )

  const chartData = useMemo(
    () =>
      fillTrend(data?.trends ?? [], timeframe).map((t) => ({
        label: formatBucketLabel(t.bucket, timeframe),
        total: t.total,
        success: t.success,
        failed: t.failed,
      })),
    [data?.trends, timeframe],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              type="button"
              onClick={() => onTimeframeChange(tf.value)}
              className="rounded-md px-3 py-1 text-xs font-medium transition"
              style={{
                background: timeframe === tf.value ? 'var(--p-soft)' : 'transparent',
                color: timeframe === tf.value ? 'var(--p-1)' : 'var(--text-3)',
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={22} className="animate-spin text-muted-foreground" />
        </div>
      ) : totals.total === 0 ? (
        <EmptyState
          icon={<BarChart3 size={28} />}
          title="No automation activity yet"
          description="Once your workflows start running, run volume, success rates and trends appear here."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Activity size={16} />} label="Runs" value={totals.total} color="#60a5fa" />
            <StatCard icon={<CheckCircle2 size={16} />} label="Success rate" value={`${totals.rate}%`} color="#22c55e" />
            <StatCard icon={<XCircle size={16} />} label="Failed" value={totals.failed} color="#f87171" />
            <StatCard icon={<CircleSlash size={16} />} label="Skipped" value={totals.skipped} color="#f59e0b" />
          </div>

          <ToggleableChart
            title="Run trend"
            subtitle="Workflow runs over time"
            icon={<TrendingUp size={14} />}
            data={chartData}
            xKey="label"
            series={[
              { key: 'success', name: 'Success', color: '#22c55e' },
              { key: 'failed', name: 'Failed', color: '#f87171' },
            ]}
            defaultKind="line"
            storageKey="automation-run-trend"
            showLegend
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Most active" subtitle="Top workflows this period" icon={<TrendingUp size={14} />}>
              <RankedList items={mostActive} valueFormatter={(v) => `${v.toLocaleString()} runs`} emptyText="No runs yet." />
            </ChartCard>
            <ChartCard title="Failing workflows" subtitle="Workflows that errored this period" icon={<XCircle size={14} />}>
              <RankedList items={failures} barColor="#f87171" valueFormatter={(v) => `${v.toLocaleString()} failed`} emptyText="No failures — everything ran cleanly." />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  color: string
}) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}1f`, color }}>
          {icon}
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p className="font-mono text-3xl font-bold text-foreground">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  )
}
