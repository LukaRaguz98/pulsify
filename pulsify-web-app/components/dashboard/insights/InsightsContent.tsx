'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Lightbulb,
  Activity,
  MessageSquare,
  MessagesSquare,
  Mic,
  UserPlus,
  UserCheck,
  TrendingUp,
  ShieldAlert,
  Terminal,
  CalendarDays,
  CalendarClock,
  Clock,
  PieChart,
  Flame,
  BarChart3,
  Hash,
  Users,
  ShieldX,
  Sparkles,
  Gauge,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { CategorySection } from '@/components/ui/category-section'
import { ChartCard } from '@/components/dashboard/charts/ChartCard'
import { ToggleableChart } from '@/components/dashboard/charts/ToggleableChart'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { TimeframeFilter } from '@/components/dashboard/TimeframeFilter'
import { useInsights } from '@/lib/use-insights'
import { formatDuration, formatHourLabel, timeframePeriodLabel, type Timeframe } from '@/lib/analytics'
import {
  CATEGORY_META,
  SEVERITY_META,
  type InsightCategory,
  type InsightSeverity,
  type HealthScore,
  type InsightsData,
} from '@/lib/insights'
import { TrendStat } from './TrendStat'
import { RecommendationCard } from './RecommendationCard'
import { ActivityHeatmap } from './ActivityHeatmap'
import { InsightIcon } from './icons'

type Props = {
  guildId: string
  guildName: string
}

// Mon-first week — getUTCDay() is 0=Sun..6=Sat, remapped via (day + 6) % 7.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function InsightsContent({ guildId, guildName }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('7d')
  const [activeCategory, setActiveCategory] = useState<InsightCategory | 'all'>('all')
  const { data, loading, refreshing, error, refresh } = useInsights(guildId, timeframe)

  const header = (
    <PageHeader
      title="Insights"
      helpId="insights"
      description={
        <>
          Smart recommendations and health analysis for{' '}
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
        <Skeleton className="mb-8 h-[168px]" />
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[124px]" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[150px]" />
          ))}
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
            {error ?? 'Insights are unavailable right now.'}
          </p>
        </div>
      </div>
    )
  }

  const { overview, comparison } = data
  // Effective window length (derived from the data for 'all') and the period
  // phrase shared with the rest of the analytics views.
  const windowDays = data.windowDays
  const periodLabel = timeframePeriodLabel(timeframe)
  const cur = overview.current
  const prev = overview.previous
  const net = cur.joins - cur.leaves
  const prevNet = prev.joins - prev.leaves

  // ── Derived vitals (ratios that interpret the data — not shown elsewhere) ──
  const participationPct =
    overview.totalMembers > 0
      ? Math.min(100, Math.round((overview.activeUsers / overview.totalMembers) * 100))
      : 0
  const msgsPerActive = overview.activeUsers > 0 ? cur.messages / overview.activeUsers : 0
  const top3Messages = data.topChannels
    .slice(0, 3)
    .reduce((sum, c) => sum + Number(c.message_count), 0)
  const concentrationPct =
    cur.messages > 0 ? Math.min(100, Math.round((top3Messages / cur.messages) * 100)) : 0

  // ── Day-of-week activity pattern (Statistics only shows peak *hour*) ──
  const weekdayTotals = new Array(7).fill(0)
  for (const p of data.series) {
    const idx = (new Date(p.bucket).getUTCDay() + 6) % 7
    weekdayTotals[idx] += Number(p.messages)
  }
  const weekdayData = WEEKDAYS.map((day, i) => ({ day, messages: weekdayTotals[i] }))
  const maxWeekday = Math.max(...weekdayTotals)
  const busiestDay = maxWeekday > 0 ? WEEKDAYS[weekdayTotals.indexOf(maxWeekday)] : null
  const quietestDay =
    maxWeekday > 0 ? WEEKDAYS[weekdayTotals.indexOf(Math.min(...weekdayTotals))] : null
  const dailyAvg = Math.round(cur.messages / windowDays)

  // ── Peak Activity Map — day×hour heatmap (the headline new feature) ──
  const heatmapCells: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  let heatMax = 0
  let bestSlot: { dow: number; hour: number; count: number } | null = null
  for (const c of data.heatmap) {
    if (c.dow < 0 || c.dow > 6 || c.hour < 0 || c.hour > 23) continue
    const v = Number(c.message_count)
    heatmapCells[c.dow][c.hour] = v
    if (v > heatMax) heatMax = v
    if (v > 0 && (!bestSlot || v > bestSlot.count)) bestSlot = { dow: c.dow, hour: c.hour, count: v }
  }
  const hasHeatmap = heatMax > 0
  const bestTimeLabel = bestSlot
    ? `${WEEKDAYS[bestSlot.dow]} · ${formatHourLabel(bestSlot.hour)}`
    : busiestDay ?? '—'

  // Recommendation filtering by category. Build the chip set from categories
  // actually present so we never show an empty filter.
  const { recommendations } = data
  const presentCategories = (Object.keys(CATEGORY_META) as InsightCategory[]).filter((c) =>
    recommendations.some((r) => r.category === c),
  )
  const filtered =
    activeCategory === 'all'
      ? recommendations
      : recommendations.filter((r) => r.category === activeCategory)

  const fmt = (n: number) => n.toLocaleString()

  return (
    <div className="page-content">
      {header}

      <div className="space-y-8">
        {/* ── Health hero ──────────────────────────────────────────────── */}
        <HealthHero
          health={data.health}
          recommendations={recommendations}
          activeUsers={overview.activeUsers}
          totalMembers={overview.totalMembers}
          windowDays={windowDays}
        />

        {!data.hasActivity && (
          <div
            className="flex items-center gap-3 rounded-xl border p-4"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            <Activity size={16} style={{ color: 'var(--text-3)' }} />
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>
              Pulse hasn’t recorded much activity yet — engagement metrics will fill in as your
              members chat, join voice and use commands. Recommendations below still apply.
            </p>
          </div>
        )}

        {/* ── Engagement overview — this period vs the one before ──────────── */}
        <CategorySection
          icon={<BarChart3 size={14} />}
          title="Engagement Overview"
          description={
            comparison
              ? `How ${periodLabel} compares to the period before — the trend you won’t find on Statistics.`
              : `Activity over ${periodLabel}.`
          }
        >
          <div className="insight-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TrendStat
              label="Messages"
              value={fmt(cur.messages)}
              sub={comparison ? `Previous: ${fmt(prev.messages)}` : undefined}
              icon={<MessageSquare size={16} />}
              accent="var(--p-1)"
              trend={overview.trends.messages}
              goodDirection="up"
              hideTrend={!comparison}
            />
            <TrendStat
              label="Voice Time"
              value={formatDuration(cur.voice_seconds)}
              sub={comparison ? `Previous: ${formatDuration(prev.voice_seconds)}` : undefined}
              icon={<Mic size={16} />}
              accent="#22d3ee"
              trend={overview.trends.voice_seconds}
              goodDirection="up"
              hideTrend={!comparison}
            />
            <TrendStat
              label="New Members"
              value={fmt(cur.joins)}
              sub={comparison ? `Previous: ${fmt(prev.joins)}` : undefined}
              icon={<UserPlus size={16} />}
              accent="#10b981"
              trend={overview.trends.joins}
              goodDirection="up"
              hideTrend={!comparison}
            />
            <TrendStat
              label="Net Growth"
              value={`${net >= 0 ? '+' : ''}${fmt(net)}`}
              sub={comparison ? `Previous: ${prevNet >= 0 ? '+' : ''}${fmt(prevNet)}` : undefined}
              icon={<TrendingUp size={16} />}
              accent="#8b5cf6"
              trend={overview.trends.netGrowth}
              goodDirection="up"
              hideTrend={!comparison}
            />
            <TrendStat
              label="Mod Actions"
              value={fmt(cur.mod_actions)}
              sub={comparison ? `Previous: ${fmt(prev.mod_actions)}` : undefined}
              icon={<ShieldAlert size={16} />}
              accent="#f87171"
              trend={overview.trends.mod_actions}
              goodDirection="none"
              hideTrend={!comparison}
            />
            <TrendStat
              label="Commands"
              value={fmt(cur.commands)}
              sub={comparison ? `Previous: ${fmt(prev.commands)}` : undefined}
              icon={<Terminal size={16} />}
              accent="#f59e0b"
              trend={overview.trends.commands}
              goodDirection="up"
              hideTrend={!comparison}
            />
          </div>
        </CategorySection>

        {/* ── Server vitals — derived ratios not shown anywhere else ──────── */}
        <CategorySection
          icon={<Gauge size={14} />}
          title="Server Vitals"
          description="Ratios that interpret your activity — participation, depth and how concentrated it is."
        >
          <div className="insight-grid grid gap-4 sm:grid-cols-3">
            <VitalCard
              label="Member Participation"
              value={`${participationPct}%`}
              sub={`${fmt(overview.activeUsers)} of ${overview.totalMembers > 0 ? fmt(overview.totalMembers) : '—'} members were active`}
              icon={<UserCheck size={16} />}
              accent="#10b981"
              bar={participationPct}
            />
            <VitalCard
              label="Engagement Depth"
              value={msgsPerActive >= 10 ? Math.round(msgsPerActive).toLocaleString() : msgsPerActive.toFixed(1)}
              sub="Messages per active member"
              icon={<MessagesSquare size={16} />}
              accent="var(--p-1)"
            />
            <VitalCard
              label="Activity Concentration"
              value={`${concentrationPct}%`}
              sub={
                data.topChannels[0]?.channel_name
                  ? `of messages from your top 3 channels`
                  : 'No channel activity yet'
              }
              icon={<PieChart size={16} />}
              accent="#22d3ee"
              bar={concentrationPct}
            />
          </div>
        </CategorySection>

        {/* ── Smart recommendations ────────────────────────────────────── */}
        <CategorySection
          icon={<Lightbulb size={14} />}
          title={`Smart Recommendations · ${recommendations.length}`}
          description="Prioritised, actionable suggestions based on your server’s data."
        >
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              label="All"
              count={recommendations.length}
              active={activeCategory === 'all'}
              accent="var(--p-1)"
              onClick={() => setActiveCategory('all')}
            />
            {presentCategories.map((c) => (
              <FilterChip
                key={c}
                label={CATEGORY_META[c].label}
                icon={CATEGORY_META[c].icon}
                count={recommendations.filter((r) => r.category === c).length}
                active={activeCategory === c}
                accent={CATEGORY_META[c].accent}
                onClick={() => setActiveCategory(c)}
              />
            ))}
          </div>

          <div className="insight-grid grid gap-4 lg:grid-cols-2">
            {filtered.map((rec) => (
              <RecommendationCard key={rec.id} guildId={guildId} rec={rec} />
            ))}
          </div>
        </CategorySection>

        {/* ── Peak Activity Map — when the community is online (day × hour) ── */}
        <CategorySection
          icon={<CalendarClock size={14} />}
          title="Peak Activity Map"
          description="Exactly when your community is online, by day and hour — so you know the best time to post."
        >
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              {hasHeatmap ? (
                <ChartCard
                  title="Activity Heatmap"
                  subtitle={`Messages by day & hour (UTC, last ${data.heatmapDays} days)`}
                  icon={<CalendarClock size={15} />}
                >
                  <ActivityHeatmap cells={heatmapCells} max={heatMax} />
                </ChartCard>
              ) : (
                <ToggleableChart
                  title="Activity by Day of Week"
                  subtitle={`Messages per weekday over the last ${windowDays * 2} days (UTC)`}
                  icon={<CalendarDays size={15} />}
                  defaultKind="bar"
                  data={weekdayData}
                  xKey="day"
                  series={[{ key: 'messages', name: 'Messages', color: 'var(--p-1)' }]}
                  storageKey="insights-weekday"
                />
              )}
            </div>

            <ChartCard title="Best Time to Engage" subtitle="Reach the most people" icon={<Clock size={15} />}>
              <div
                className="mb-4 rounded-lg border p-3"
                style={{ background: 'var(--p-soft)', borderColor: 'var(--line-strong)' }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--p-1)' }}>
                  Peak window
                </p>
                <p className="mt-0.5 text-lg font-bold text-foreground">{bestTimeLabel}</p>
              </div>
              <ul className="space-y-4">
                <HighlightRow
                  label="Busiest day"
                  value={busiestDay ?? '—'}
                  icon={<Flame size={14} />}
                  accent="#f59e0b"
                />
                <HighlightRow
                  label="Quietest day"
                  value={quietestDay ?? '—'}
                  icon={<CalendarDays size={14} />}
                  accent="var(--text-3)"
                />
                <HighlightRow
                  label="Daily average"
                  value={`${fmt(dailyAvg)} msgs`}
                  icon={<MessageSquare size={14} />}
                  accent="var(--p-1)"
                />
              </ul>
              <Link
                href={`/dashboard/${guildId}/scheduled`}
                className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-transform"
                style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
              >
                <CalendarClock size={13} />
                Schedule for peak time
              </Link>
            </ChartCard>
          </div>
        </CategorySection>

        {/* ── Housekeeping ─────────────────────────────────────────────── */}
        <CategorySection
          icon={<Sparkles size={14} />}
          title="Server Housekeeping"
          description="Inactive channels, unused roles and roles with risky permissions."
        >
          <div className="grid gap-5 lg:grid-cols-3">
            <ChartCard title="Inactive Channels" subtitle="No messages in weeks" icon={<Hash size={15} />}>
              {data.inactiveChannels.length === 0 ? (
                <EmptyHint text="Every channel has seen recent activity." />
              ) : (
                <ul className="space-y-2.5">
                  {data.inactiveChannels.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                        <Hash size={13} className="shrink-0 text-subtle" />
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-subtle">
                        {c.daysInactive}d quiet
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ChartCard>

            <ChartCard title="Unused Roles" subtitle="Assigned to nobody" icon={<Users size={15} />}>
              {!data.unusedRolesReliable ? (
                <EmptyHint text="Skipped — this server is too large to sample role membership reliably." />
              ) : data.unusedRoles.length === 0 ? (
                <EmptyHint text="Every role is assigned to at least one member." />
              ) : (
                <ul className="space-y-2.5">
                  {data.unusedRoles.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 text-sm">
                      <RoleDot color={r.color} />
                      <span className="truncate text-muted-foreground">{r.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </ChartCard>

            <ChartCard title="Risky Roles" subtitle="High-impact permissions" icon={<ShieldX size={15} />}>
              {data.dangerousRoles.length === 0 ? (
                <EmptyHint text="No roles grant high-risk permissions." />
              ) : (
                <ul className="space-y-3">
                  {data.dangerousRoles.map((r) => (
                    <li key={r.id} className="text-sm">
                      <div className="flex items-center gap-2">
                        <RoleDot color={r.color} />
                        <span className="truncate font-medium text-foreground">{r.name}</span>
                      </div>
                      <p className="mt-0.5 pl-4 text-xs text-subtle">{r.permissions.join(', ')}</p>
                    </li>
                  ))}
                </ul>
              )}
            </ChartCard>
          </div>
        </CategorySection>
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

// ── Health hero ────────────────────────────────────────────────────────────

function HealthHero({
  health,
  recommendations,
  activeUsers,
  totalMembers,
  windowDays,
}: {
  health: HealthScore
  recommendations: InsightsData['recommendations']
  activeUsers: number
  totalMembers: number
  windowDays: number
}) {
  const counts = recommendations.reduce<Record<InsightSeverity, number>>(
    (acc, r) => {
      acc[r.severity] += 1
      return acc
    },
    { critical: 0, warning: 0, suggestion: 0, positive: 0 },
  )
  const orderedSeverities: InsightSeverity[] = ['critical', 'warning', 'suggestion', 'positive']

  return (
    <div
      className="insight-card grid items-center gap-6 rounded-2xl border p-6 sm:grid-cols-[auto_1fr]"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <HealthRing score={health.score} accent={health.accent} />

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Gauge size={15} style={{ color: health.accent }} />
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-2)' }}>
            Server Health
          </h2>
        </div>
        <p className="mt-1 text-2xl font-bold text-foreground">
          {health.label}
          <span className="ml-2 text-sm font-normal text-subtle">
            {activeUsers.toLocaleString()} active ·{' '}
            {totalMembers > 0 ? totalMembers.toLocaleString() : '—'} members
          </span>
        </p>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-3)' }}>
          Based on activity, moderation, growth and structure over the last {windowDays} days.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {orderedSeverities.map((sev) => {
            const meta = SEVERITY_META[sev]
            return (
              <span key={sev} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-2)' }}>
                <span className="h-2 w-2 rounded-full" style={{ background: meta.accent }} />
                <span className="font-semibold text-foreground">{counts[sev]}</span>
                {meta.label.toLowerCase()}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function HealthRing({ score, accent }: { score: number; accent: string }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100)
  return (
    <div className="relative h-[120px] w-[120px] shrink-0">
      <svg width={120} height={120} viewBox="0 0 120 120">
        <circle cx={60} cy={60} r={radius} fill="none" stroke="var(--bg-2)" strokeWidth={10} />
        <circle
          cx={60}
          cy={60}
          r={radius}
          fill="none"
          stroke={accent}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-3xl font-bold"
          style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', color: 'var(--text)' }}
        >
          {score}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">/ 100</span>
      </div>
    </div>
  )
}

// ── Server vitals ────────────────────────────────────────────────────────────

function VitalCard({
  label,
  value,
  sub,
  icon,
  accent,
  bar,
}: {
  label: string
  value: string
  sub: string
  icon: React.ReactNode
  accent: string
  bar?: number
}) {
  return (
    <div
      className="insight-card rounded-xl border p-5"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}
        >
          {icon}
        </span>
      </div>
      <p
        className="text-3xl font-bold tracking-tight"
        style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', color: 'var(--text)' }}
      >
        {value}
      </p>
      {bar !== undefined && (
        <div className="mt-3 h-1.5 w-full rounded-full" style={{ background: 'var(--bg-2)' }}>
          <div
            className="h-1.5 rounded-full transition-all"
            style={{ width: `${Math.max(0, Math.min(100, bar))}%`, background: accent }}
          />
        </div>
      )}
      <p className="mt-2 text-xs text-subtle">{sub}</p>
    </div>
  )
}

function HighlightRow({
  label,
  value,
  icon,
  accent,
}: {
  label: string
  value: string
  icon: React.ReactNode
  accent: string
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <span style={{ color: accent }}>{icon}</span>
        {label}
      </span>
      <span className="font-semibold text-foreground">{value}</span>
    </li>
  )
}

// ── Small pieces ──────────────────────────────────────────────────────────

function FilterChip({
  label,
  icon,
  count,
  active,
  accent,
  onClick,
}: {
  label: string
  icon?: string
  count: number
  active: boolean
  accent: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
      style={
        active
          ? { background: `color-mix(in srgb, ${accent} 16%, transparent)`, borderColor: accent, color: accent }
          : { background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text-3)' }
      }
    >
      {icon && <InsightIcon name={icon} size={12} />}
      {label}
      <span className="font-mono opacity-70">{count}</span>
    </button>
  )
}

function RoleDot({ color }: { color: number }) {
  return (
    <span
      className="h-3 w-3 shrink-0 rounded-full border"
      style={{
        backgroundColor: color !== 0 ? `#${color.toString(16).padStart(6, '0')}` : '#6b6d82',
        borderColor: 'var(--line-strong)',
      }}
    />
  )
}

function EmptyHint({ text }: { text: string }) {
  return <p className="py-1 text-sm text-subtle">{text}</p>
}

