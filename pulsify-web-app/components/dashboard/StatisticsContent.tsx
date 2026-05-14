'use client'

import { useState } from 'react'
import {
  MessageSquare,
  Mic,
  Terminal,
  ShieldAlert,
  Users,
  UserPlus,
  UserMinus,
  TrendingUp,
  Clock,
  BarChart3,
  Hash,
  Activity,
  LayoutGrid,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { CategorySection } from '@/components/ui/category-section'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { TimeframeFilter } from '@/components/dashboard/TimeframeFilter'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { RankedList } from '@/components/dashboard/RankedList'
import { ChartCard } from '@/components/dashboard/charts/ChartCard'
import { ToggleableChart } from '@/components/dashboard/charts/ToggleableChart'
import { useAnalytics } from '@/lib/use-analytics'
import {
  fillTimeseries,
  formatBucketLabel,
  formatDuration,
  formatHourLabel,
  summaryIsEmpty,
  type Timeframe,
} from '@/lib/analytics'

type Props = {
  guildId: string
  guildName: string
}

export function StatisticsContent({ guildId, guildName }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('24h')
  const { data, loading, refreshing, error, refresh } = useAnalytics(guildId, timeframe)

  const header = (
    <PageHeader
      title="Statistics"
      description={
        <>
          Detailed server activity metrics for{' '}
          <span className="font-medium text-foreground">{guildName}</span>
        </>
      }
      action={
        <div className="flex items-center gap-3">
          <TimeframeFilter value={timeframe} onChange={setTimeframe} disabled={loading} />
          <RefreshButton onClick={refresh} refreshing={refreshing} />
        </div>
      }
    />
  )

  if (loading) {
    return (
      <div className="page-content">
        {header}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[116px]" />
          ))}
        </div>
        <Skeleton className="mb-6 h-[300px]" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[300px]" />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="page-content">
        {header}
        <div
          className="flex items-center gap-3 rounded-xl border p-5"
          style={{ background: 'var(--panel)', borderColor: 'rgba(239,68,68,0.35)' }}
        >
          <AlertCircle size={18} style={{ color: '#f87171' }} />
          <p className="text-sm text-muted-foreground">
            {error ?? 'Statistics are unavailable right now.'}
          </p>
        </div>
      </div>
    )
  }

  const { summary } = data
  const series = fillTimeseries(data.timeseries, timeframe)
  const xFmt = (v: string) => formatBucketLabel(v, timeframe)
  const netGrowth = summary.member_joins - summary.member_leaves
  const empty = summaryIsEmpty(summary)

  const peakData = Array.from({ length: 24 }, (_, h) => {
    const found = data.peakHours.find((p) => p.hour === h)
    return { hour: h, message_count: found ? Number(found.message_count) : 0 }
  })
  const busiestHour = peakData.reduce(
    (best, p) => (p.message_count > best.message_count ? p : best),
    peakData[0]
  )

  const topChannels = data.topChannels.map((c) => ({
    id: c.channel_id,
    label: c.channel_name ? `#${c.channel_name}` : c.channel_id,
    value: Number(c.message_count),
  }))
  const topUsers = data.topUsers.map((u) => ({
    id: u.user_id,
    label: u.user_name ?? u.user_id,
    value: Number(u.message_count),
  }))

  const bucketLabel = timeframe === '24h' ? 'hour' : 'day'

  return (
    <div className="page-content">
      {header}

      <div className="space-y-8">
        {/* ── Key Metrics ──────────────────────────────────────────────── */}
        <CategorySection
          icon={<LayoutGrid size={14} />}
          title="Key Metrics"
          description="Headline activity totals for the selected period."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              label="Total Messages"
              value={summary.total_messages}
              sub="Messages sent"
              icon={<MessageSquare size={16} />}
              accent="var(--p-1)"
            />
            <StatsCard
              label="Voice Time"
              value={formatDuration(summary.voice_seconds)}
              sub="Total time in voice"
              icon={<Mic size={16} />}
              accent="#22d3ee"
            />
            <StatsCard
              label="Bot Commands"
              value={summary.total_commands}
              sub="Slash commands executed"
              icon={<Terminal size={16} />}
              accent="#f59e0b"
            />
            <StatsCard
              label="Moderation Actions"
              value={summary.total_mod_actions}
              sub="Bans, unbans & warnings"
              icon={<ShieldAlert size={16} />}
              accent="#ec4899"
            />
            <StatsCard
              label="Active Users"
              value={summary.active_users}
              sub="Members who sent messages"
              icon={<Users size={16} />}
              accent="#8b5cf6"
            />
            <StatsCard
              label="Member Joins"
              value={summary.member_joins}
              sub="New members"
              icon={<UserPlus size={16} />}
              accent="#10b981"
            />
            <StatsCard
              label="Member Leaves"
              value={summary.member_leaves}
              sub="Members who left"
              icon={<UserMinus size={16} />}
              accent="#ef4444"
            />
            <StatsCard
              label="Net Growth"
              value={`${netGrowth >= 0 ? '+' : ''}${netGrowth}`}
              sub={
                busiestHour.message_count > 0
                  ? `Peak hour: ${formatHourLabel(busiestHour.hour)}`
                  : 'No peak yet'
              }
              icon={<TrendingUp size={16} />}
              accent="#06b6d4"
            />
          </div>
        </CategorySection>

        {empty ? (
          <EmptyState
            icon={<Activity size={36} />}
            title="No statistics recorded yet"
            description="The Pulse bot collects activity data as it observes your server. Once members start chatting, joining voice and using commands, detailed statistics will appear here."
          />
        ) : (
          <>
            {/* ── Activity & Engagement ──────────────────────────────────── */}
            <CategorySection
              icon={<Activity size={14} />}
              title="Activity & Engagement"
              description="Message volume, peak hours and voice channel activity."
            >
              <div className="grid gap-5 lg:grid-cols-2">
                <ToggleableChart
                  title="Activity Breakdown"
                  subtitle={`Messages, commands and mod actions per ${bucketLabel}`}
                  icon={<Activity size={15} />}
                  defaultKind="line"
                  data={series}
                  xKey="bucket"
                  series={[
                    { key: 'messages', name: 'Messages', color: 'var(--p-1)' },
                    { key: 'commands', name: 'Commands', color: 'var(--amber)' },
                    { key: 'mod_actions', name: 'Mod actions', color: 'var(--pink)' },
                  ]}
                  xTickFormatter={xFmt}
                  showLegend
                />
                <ToggleableChart
                  title="Peak Activity Times"
                  subtitle="Message volume by hour of day (UTC)"
                  icon={<Clock size={15} />}
                  defaultKind="bar"
                  data={peakData}
                  xKey="hour"
                  series={[{ key: 'message_count', name: 'Messages', color: 'var(--cyan)' }]}
                  xTickFormatter={(v) => formatHourLabel(Number(v))}
                />
              </div>

              <ToggleableChart
                title="Voice Activity"
                subtitle={`Voice channel time per ${bucketLabel}`}
                icon={<Mic size={15} />}
                defaultKind="bar"
                data={series}
                xKey="bucket"
                series={[{ key: 'voice_seconds', name: 'Voice time', color: 'var(--cyan)' }]}
                xTickFormatter={xFmt}
                yTickFormatter={(v) => formatDuration(v)}
                tooltipValueFormatter={(v) => formatDuration(v)}
              />
            </CategorySection>

            {/* ── Members ────────────────────────────────────────────────── */}
            <CategorySection
              icon={<Users size={14} />}
              title="Members"
              description="Member joins and leaves over time."
            >
              <ToggleableChart
                title="Member Growth"
                subtitle={`Joins and leaves per ${bucketLabel}`}
                icon={<TrendingUp size={15} />}
                defaultKind="line"
                data={series}
                xKey="bucket"
                series={[
                  { key: 'joins', name: 'Joins', color: 'var(--green)' },
                  { key: 'leaves', name: 'Leaves', color: 'var(--red)' },
                ]}
                xTickFormatter={xFmt}
                showLegend
              />
            </CategorySection>

            {/* ── Commands & Moderation ──────────────────────────────────── */}
            <CategorySection
              icon={<ShieldAlert size={14} />}
              title="Commands & Moderation"
              description="Bot command usage and moderation activity over time."
            >
              <div className="grid gap-5 lg:grid-cols-2">
                <ToggleableChart
                  title="Command Usage"
                  subtitle={`Bot commands executed per ${bucketLabel}`}
                  icon={<Terminal size={15} />}
                  defaultKind="bar"
                  data={series}
                  xKey="bucket"
                  series={[{ key: 'commands', name: 'Commands', color: 'var(--amber)' }]}
                  xTickFormatter={xFmt}
                />
                <ToggleableChart
                  title="Moderation Activity"
                  subtitle={`Moderation actions per ${bucketLabel}`}
                  icon={<ShieldAlert size={15} />}
                  defaultKind="bar"
                  data={series}
                  xKey="bucket"
                  series={[{ key: 'mod_actions', name: 'Mod actions', color: 'var(--pink)' }]}
                  xTickFormatter={xFmt}
                />
              </div>
            </CategorySection>

            {/* ── Leaderboards ───────────────────────────────────────────── */}
            <CategorySection
              icon={<BarChart3 size={14} />}
              title="Leaderboards"
              description="The most active channels and members in your server."
            >
              <div className="grid gap-5 lg:grid-cols-2">
                <ChartCard
                  title="Top Active Channels"
                  subtitle="Channels with the most messages"
                  icon={<Hash size={15} />}
                >
                  <RankedList items={topChannels} emptyText="No channel activity yet." />
                </ChartCard>
                <ChartCard
                  title="Most Active Users"
                  subtitle="Members who sent the most messages"
                  icon={<BarChart3 size={15} />}
                >
                  <RankedList
                    items={topUsers}
                    barColor="var(--cyan)"
                    emptyText="No member activity yet."
                  />
                </ChartCard>
              </div>
            </CategorySection>
          </>
        )}
      </div>

      {refreshing && (
        <div className="mt-4 flex items-center gap-2 text-xs text-subtle">
          <Loader2 size={12} className="animate-spin" />
          Updating…
        </div>
      )}
    </div>
  )
}
