'use client'

import { useMemo } from 'react'
import {
  Activity,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  Loader2,
  BarChart3,
} from 'lucide-react'
import type { CommandDefinition } from '@/lib/commands'
import { TIMEFRAMES, formatBucketLabel, type Timeframe } from '@/lib/analytics'
import { ToggleableChart } from '@/components/dashboard/charts/ToggleableChart'
import { ChartCard } from '@/components/dashboard/charts/ChartCard'
import { RankedList, type RankedItem } from '@/components/dashboard/RankedList'
import { EmptyState } from '@/components/ui/empty-state'
import type { CommandAnalytics as CommandAnalyticsData } from '@/app/api/guilds/[guildId]/commands/analytics/route'

type Props = {
  /** The bot-published catalog, so unused commands still rank (value 0). */
  catalog: CommandDefinition[]
  data: CommandAnalyticsData | null
  loading: boolean
  timeframe: Timeframe
  onTimeframeChange: (tf: Timeframe) => void
}

export function CommandAnalytics({ catalog, data, loading, timeframe, onTimeframeChange }: Props) {
  const stats = useMemo(() => data?.stats ?? [], [data])

  const totals = useMemo(() => {
    let total = 0
    let success = 0
    let failed = 0
    let denied = 0
    for (const s of stats) {
      total += s.total
      success += s.success
      failed += s.failed
      denied += s.denied
    }
    const rate = total > 0 ? Math.round((success / total) * 100) : 0
    return { total, success, failed, denied, rate }
  }, [stats])

  // Usage by command, merged with the full catalog so unused commands surface
  // in the "least used" list (value 0) instead of silently disappearing.
  const usageByName = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of stats) map.set(s.command_name, s.total)
    return map
  }, [stats])

  const mostUsed: RankedItem[] = useMemo(
    () =>
      [...catalog]
        .map((c) => ({ id: c.name, label: `/${c.name}`, value: usageByName.get(c.name) ?? 0 }))
        .filter((i) => i.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
    [usageByName, catalog],
  )

  const leastUsed: RankedItem[] = useMemo(
    () =>
      [...catalog]
        .map((c) => ({ id: c.name, label: `/${c.name}`, value: usageByName.get(c.name) ?? 0 }))
        .sort((a, b) => a.value - b.value)
        .slice(0, 6),
    [usageByName, catalog],
  )

  const failures: RankedItem[] = useMemo(
    () =>
      stats
        .filter((s) => s.failed > 0)
        .map((s) => ({ id: s.command_name, label: `/${s.command_name}`, value: s.failed }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
    [stats],
  )

  const chartData = useMemo(
    () =>
      (data?.trends ?? []).map((t) => ({
        label: formatBucketLabel(t.bucket, timeframe),
        total: t.total,
        success: t.success,
        failed: t.failed,
      })),
    [data?.trends, timeframe],
  )

  return (
    <div className="space-y-6">
      {/* Timeframe filter */}
      <div className="flex items-center justify-end">
        <div
          className="inline-flex rounded-lg border p-0.5"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
        >
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
          title="No command activity yet"
          description="Once members start running Pulse commands, usage stats, success rates and trends will appear here."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Activity size={16} />} label="Executions" value={totals.total} color="#60a5fa" />
            <StatCard icon={<CheckCircle2 size={16} />} label="Success rate" value={`${totals.rate}%`} color="#22c55e" />
            <StatCard icon={<XCircle size={16} />} label="Failed" value={totals.failed} color="#f87171" />
            <StatCard icon={<ShieldAlert size={16} />} label="Blocked" value={totals.denied} color="#f59e0b" />
          </div>

          <ToggleableChart
            title="Usage trend"
            subtitle="Command executions over time"
            icon={<TrendingUp size={14} />}
            data={chartData}
            xKey="label"
            series={[
              { key: 'success', name: 'Success', color: '#22c55e' },
              { key: 'failed', name: 'Failed', color: '#f87171' },
            ]}
            defaultKind="bar"
            showLegend
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Most used" subtitle="Top commands this period" icon={<TrendingUp size={14} />}>
              <RankedList items={mostUsed} valueFormatter={(v) => `${v.toLocaleString()} uses`} emptyText="No usage yet." />
            </ChartCard>
            <ChartCard title="Least used" subtitle="Quietest commands (incl. unused)" icon={<TrendingDown size={14} />}>
              <RankedList
                items={leastUsed}
                barColor="var(--text-3)"
                valueFormatter={(v) => `${v.toLocaleString()} uses`}
                emptyText="No commands."
              />
            </ChartCard>
          </div>

          <ChartCard title="Failed executions" subtitle="Commands that errored during this period" icon={<XCircle size={14} />}>
            <RankedList items={failures} barColor="#f87171" valueFormatter={(v) => `${v.toLocaleString()} failed`} emptyText="No failures recorded — everything ran cleanly." />
          </ChartCard>
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
