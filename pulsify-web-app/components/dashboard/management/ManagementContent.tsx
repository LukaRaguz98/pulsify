'use client'

import { useState } from 'react'
import {
  Users,
  ShieldAlert,
  LifeBuoy,
  Megaphone,
  Activity,
  AlertCircle,
  Loader2,
  Search,
  Download,
  Trophy,
  Crown,
  Zap,
  Gauge,
  Clock,
  CheckCircle2,
  Inbox,
  BarChart3,
  ChevronRight,
  UserCog,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { CategorySection } from '@/components/ui/category-section'
import { ChartCard } from '@/components/dashboard/charts/ChartCard'
import { ToggleableChart } from '@/components/dashboard/charts/ToggleableChart'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { TimeframeFilter } from '@/components/dashboard/TimeframeFilter'
import { TrendStat } from '@/components/dashboard/insights/TrendStat'
import { useManagement } from '@/lib/use-management'
import { formatHourLabel, timeframePeriodLabel, type Timeframe } from '@/lib/analytics'
import {
  ROLE_META,
  INSIGHT_SEVERITY_META,
  formatSeconds,
  type ManagementData,
  type StaffMemberStats,
  type StaffRole,
  type LeaderboardEntry,
} from '@/lib/management'
import { ManagementIcon } from './icons'
import { StaffAvatar } from './StaffAvatar'
import { StaffProfileDrawer } from './StaffProfileDrawer'

type Props = { guildId: string; guildName: string }

type RoleFilter = StaffRole | 'all'

const ROLE_FILTERS: { value: RoleFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'moderator', label: 'Moderators' },
  { value: 'support', label: 'Support' },
  { value: 'administrator', label: 'Admins' },
]

export function ManagementContent({ guildId, guildName }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('7d')
  const { data, loading, refreshing, error, refresh } = useManagement(guildId, timeframe)

  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [selected, setSelected] = useState<StaffMemberStats | null>(null)

  const header = (
    <PageHeader
      title="Management"
      description={
        <>
          Staff performance and management effectiveness for{' '}
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
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[124px]" />
          ))}
        </div>
        <Skeleton className="mb-8 h-[180px]" />
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[96px]" />
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
          <p className="text-sm text-muted-foreground">{error ?? 'Management analytics are unavailable right now.'}</p>
        </div>
      </div>
    )
  }

  const { totals, comparison, windowDays } = data
  const periodLabel = timeframePeriodLabel(timeframe)
  const filteredStaff = data.staff.filter((s) => {
    if (roleFilter !== 'all' && s.role !== roleFilter) return false
    if (query.trim() && !s.name.toLowerCase().includes(query.trim().toLowerCase())) return false
    return true
  })
  const inactiveCount = data.staff.filter((s) => s.isInactive).length

  return (
    <div className="page-content">
      {header}

      {!data.hasActivity ? (
        <EmptyState />
      ) : (
        <div className="space-y-8">
          {/* ── Overview totals ─────────────────────────────────────────── */}
          <CategorySection
            icon={<BarChart3 size={14} />}
            title="Management Overview"
            description={
              comparison
                ? `Staff activity over ${periodLabel} vs the period before.`
                : `Staff activity over ${periodLabel}.`
            }
          >
            <div className="insight-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <TrendStat
                label="Active Staff"
                value={totals.activeStaff.toLocaleString()}
                sub={inactiveCount > 0 ? `${inactiveCount} inactive` : 'Everyone contributing'}
                icon={<Users size={16} />}
                accent="var(--p-1)"
                trend={totals.trends.activeStaff}
                goodDirection="up"
                hideTrend={!comparison}
              />
              <TrendStat
                label="Moderation Actions"
                value={totals.moderationActions.toLocaleString()}
                sub="Warnings, timeouts, bans…"
                icon={<ShieldAlert size={16} />}
                accent="#f87171"
                trend={totals.trends.moderationActions}
                goodDirection="none"
                hideTrend={!comparison}
              />
              <TrendStat
                label="Support Actions"
                value={totals.supportActions.toLocaleString()}
                sub={`${data.support.ticketsHandled} tickets handled`}
                icon={<LifeBuoy size={16} />}
                accent="#22d3ee"
                trend={totals.trends.supportActions}
                goodDirection="up"
                hideTrend={!comparison}
              />
              <TrendStat
                label="Community Actions"
                value={totals.communityActions.toLocaleString()}
                sub="Announcements, events, giveaways"
                icon={<Megaphone size={16} />}
                accent="#a78bfa"
                trend={totals.trends.communityActions}
                goodDirection="up"
                hideTrend={!comparison}
              />
            </div>
          </CategorySection>

          {/* ── Management insights ─────────────────────────────────────── */}
          {data.insights.length > 0 && (
            <CategorySection
              icon={<Gauge size={14} />}
              title={`Management Insights · ${data.insights.length}`}
              description="Workload balance, response health and standout contributors."
            >
              <div className="insight-grid grid gap-4 lg:grid-cols-2">
                {data.insights.map((ins) => (
                  <InsightCard
                    key={ins.id}
                    insight={ins}
                    onStaff={
                      ins.staffId
                        ? () => {
                            const s = data.staff.find((x) => x.id === ins.staffId)
                            if (s) setSelected(s)
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            </CategorySection>
          )}

          {/* ── Leaderboards ────────────────────────────────────────────── */}
          <CategorySection
            icon={<Trophy size={14} />}
            title="Rankings & Leaderboards"
            description="The people driving each area of management this period."
          >
            <div className="insight-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <LeaderCard title="Top Contributor" icon={<Crown size={15} />} accent="#fbbf24" entry={data.leaderboards.topContributor} onClick={openStaff(data, setSelected)} />
              <LeaderCard title="Most Active Moderator" icon={<ShieldAlert size={15} />} accent="#f87171" entry={data.leaderboards.mostActiveModerator} onClick={openStaff(data, setSelected)} />
              <LeaderCard title="Most Active Support" icon={<LifeBuoy size={15} />} accent="#22d3ee" entry={data.leaderboards.mostActiveSupport} onClick={openStaff(data, setSelected)} />
              <LeaderCard title="Most Active Administrator" icon={<Crown size={15} />} accent="#a78bfa" entry={data.leaderboards.mostActiveAdministrator} onClick={openStaff(data, setSelected)} />
              <LeaderCard title="Fastest Responder" icon={<Zap size={15} />} accent="#10b981" entry={data.leaderboards.fastestResponder} valueFmt={(v) => formatSeconds(v)} onClick={openStaff(data, setSelected)} />
              <LeaderCard title="Most Tickets Resolved" icon={<CheckCircle2 size={15} />} accent="#34d399" entry={data.leaderboards.mostTicketsResolved} onClick={openStaff(data, setSelected)} />
            </div>
          </CategorySection>

          {/* ── Visualizations ──────────────────────────────────────────── */}
          <CategorySection
            icon={<Activity size={14} />}
            title="Activity & Contribution"
            description="How management work splits across moderation, support and community over time."
          >
            <div className="grid gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ToggleableChart
                  title="Staff Activity Over Time"
                  subtitle={`Actions by area over ${periodLabel}`}
                  icon={<Activity size={15} />}
                  defaultKind="bar"
                  data={data.activityTimeline}
                  xKey="date"
                  stacked
                  showLegend
                  series={[
                    { key: 'moderation', name: 'Moderation', color: '#f87171' },
                    { key: 'support', name: 'Support', color: '#22d3ee' },
                    { key: 'community', name: 'Community', color: '#a78bfa' },
                  ]}
                  xTickFormatter={data.timelineGranularity === 'hour' ? formatHourTick : formatDayTick}
                  storageKey="management-timeline"
                />
              </div>
              <ContributionCard data={data} />
            </div>
          </CategorySection>

          {/* ── Support performance ─────────────────────────────────────── */}
          <CategorySection
            icon={<LifeBuoy size={14} />}
            title="Support Performance"
            description="Ticket throughput, response and resolution efficiency."
          >
            <div className="insight-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SupportStat icon={<Inbox size={16} />} label="Tickets Handled" value={data.support.ticketsHandled.toLocaleString()} accent="#22d3ee" />
              <SupportStat icon={<CheckCircle2 size={16} />} label="Resolution Rate" value={`${data.support.resolutionRatePct}%`} sub={`${data.support.ticketsResolved} resolved · ${data.support.openTickets} open`} accent="#10b981" />
              <SupportStat icon={<Clock size={16} />} label="Avg First Response" value={formatSeconds(data.support.avgFirstResponseSeconds)} accent="#f59e0b" />
              <SupportStat icon={<Gauge size={16} />} label="Avg Resolution" value={formatSeconds(data.support.avgResolutionSeconds)} accent="#a78bfa" />
            </div>
          </CategorySection>

          {/* ── Staff directory / performance table ─────────────────────── */}
          <CategorySection
            icon={<UserCog size={14} />}
            title={`Staff Performance · ${data.staff.length}`}
            description="Every staff member's contribution. Click a row for a full breakdown."
            action={
              <button
                onClick={() => exportCsv(data, guildName, timeframe)}
                className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:text-foreground"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
              >
                <Download size={13} />
                Export CSV
              </button>
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search staff…"
                  className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-[var(--p-1)]"
                  style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                />
              </div>
              <div className="inline-flex items-center gap-0.5 rounded-lg border p-0.5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                {ROLE_FILTERS.map((r) => {
                  const active = r.value === roleFilter
                  return (
                    <button
                      key={r.value}
                      onClick={() => setRoleFilter(r.value)}
                      className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                      style={active ? { background: 'var(--p-soft)', color: 'var(--p-1)' } : { color: 'var(--text-3)' }}
                    >
                      {r.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <StaffTable staff={filteredStaff} onSelect={setSelected} />
          </CategorySection>
        </div>
      )}

      {refreshing && (
        <div className="mt-4 flex items-center gap-2 text-xs text-subtle">
          <Loader2 size={12} className="animate-spin" />
          Updating…
        </div>
      )}

      <StaffProfileDrawer staff={selected} windowDays={windowDays} onClose={() => setSelected(null)} />
    </div>
  )
}

// Returns a click handler that opens the drawer for a leaderboard entry's staff.
function openStaff(data: ManagementData, setSelected: (s: StaffMemberStats | null) => void) {
  return (id: string) => {
    const s = data.staff.find((x) => x.id === id)
    if (s) setSelected(s)
  }
}

// ── Staff table ──────────────────────────────────────────────────────────────

function StaffTable({ staff, onSelect }: { staff: StaffMemberStats[]; onSelect: (s: StaffMemberStats) => void }) {
  if (staff.length === 0) {
    return <p className="py-6 text-center text-sm text-subtle">No staff match your filters.</p>
  }
  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line-strong)' }}>
      <div className="hidden grid-cols-[1.6fr_repeat(5,0.8fr)_auto] gap-3 border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-subtle sm:grid" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
        <span>Member</span>
        <span className="text-right">Moderation</span>
        <span className="text-right">Tickets</span>
        <span className="text-right">Community</span>
        <span className="text-right">Active days</span>
        <span className="text-right">Total</span>
        <span className="w-4" />
      </div>
      <ul>
        {staff.map((s, i) => {
          const role = ROLE_META[s.role]
          return (
            <li key={s.id}>
              <button
                onClick={() => onSelect(s)}
                className="grid w-full grid-cols-2 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-2)] sm:grid-cols-[1.6fr_repeat(5,0.8fr)_auto]"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <StaffAvatar name={s.name} avatar={s.avatar} size={32} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">{s.name}</span>
                      {s.isInactive && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: '#f59e0b' }} title="Inactive" />}
                    </span>
                    <span className="text-[11px]" style={{ color: role.accent }}>{role.label}</span>
                  </span>
                </span>
                <Cell value={s.moderationTotal} />
                <Cell value={s.ticketsHandled} />
                <Cell value={s.communityTotal} />
                <Cell value={`${s.activeDays}d`} dim />
                <span className="text-right font-mono text-sm font-bold text-foreground">{s.totalActions}</span>
                <ChevronRight size={15} className="hidden justify-self-end text-subtle sm:block" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Cell({ value, dim }: { value: number | string; dim?: boolean }) {
  return (
    <span className="hidden text-right font-mono text-sm sm:block" style={{ color: dim ? 'var(--text-3)' : 'var(--text)' }}>
      {value}
    </span>
  )
}

// ── Leaderboard card ─────────────────────────────────────────────────────────

function LeaderCard({
  title,
  icon,
  accent,
  entry,
  valueFmt,
  onClick,
}: {
  title: string
  icon: React.ReactNode
  accent: string
  entry: LeaderboardEntry | null
  valueFmt?: (v: number) => string
  onClick: (id: string) => void
}) {
  return (
    <div className="insight-card flex items-center gap-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{title}</p>
        {entry ? (
          <button onClick={() => onClick(entry.id)} className="mt-0.5 flex items-center gap-2 text-left">
            <StaffAvatar name={entry.name} avatar={entry.avatar} size={20} />
            <span className="truncate text-sm font-semibold text-foreground hover:underline">{entry.name}</span>
          </button>
        ) : (
          <p className="mt-1 text-sm text-subtle">No data yet</p>
        )}
      </div>
      {entry && (
        <div className="shrink-0 text-right">
          <p className="font-mono text-base font-bold" style={{ color: accent }}>
            {valueFmt ? valueFmt(entry.value) : entry.value.toLocaleString()}
          </p>
          <p className="text-[10px] text-subtle">{entry.unit}</p>
        </div>
      )}
    </div>
  )
}

// ── Insight card ─────────────────────────────────────────────────────────────

function InsightCard({ insight, onStaff }: { insight: ManagementData['insights'][number]; onStaff?: () => void }) {
  const sev = INSIGHT_SEVERITY_META[insight.severity]
  return (
    <div className="insight-card rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${sev.accent} 16%, transparent)`, color: sev.accent }}>
          <ManagementIcon name={insight.icon} size={17} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{insight.title}</h3>
            <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: `color-mix(in srgb, ${sev.accent} 14%, transparent)`, color: sev.accent }}>
              {sev.label}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>{insight.body}</p>
          {onStaff && (
            <button onClick={onStaff} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--p-1)' }}>
              View profile <ChevronRight size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Contribution breakdown ───────────────────────────────────────────────────

function ContributionCard({ data }: { data: ManagementData }) {
  const total = data.contributionBreakdown.reduce((s, c) => s + c.value, 0)
  return (
    <ChartCard title="Contribution Breakdown" subtitle="Share of all management work" icon={<BarChart3 size={15} />} disableLandscape>
      <div className="space-y-4">
        {data.contributionBreakdown.map((slice) => {
          const pct = total > 0 ? Math.round((slice.value / total) * 100) : 0
          return (
            <div key={slice.category}>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: slice.accent }} />
                  {slice.label}
                </span>
                <span className="font-mono text-xs text-foreground">{slice.value.toLocaleString()} · {pct}%</span>
              </div>
              <div className="h-2 w-full rounded-full" style={{ background: 'var(--bg-2)' }}>
                <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: slice.accent }} />
              </div>
            </div>
          )
        })}
        {total === 0 && <p className="py-2 text-sm text-subtle">No activity recorded this period.</p>}
      </div>
    </ChartCard>
  )
}

// ── Small bits ───────────────────────────────────────────────────────────────

function SupportStat({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="insight-card rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}>
          {icon}
        </span>
      </div>
      <p className="text-3xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', color: 'var(--text)' }}>{value}</p>
      {sub && <p className="mt-1.5 text-xs text-subtle">{sub}</p>}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border py-16 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
        <UserCog size={24} />
      </span>
      <h2 className="text-lg font-semibold text-foreground">No management activity yet</h2>
      <p className="mt-1 max-w-md text-sm text-subtle">
        As your team moderates, handles tickets and manages the community, their performance and rankings will appear here.
      </p>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Timeline bucket `date` values are ISO timestamps at the bucket start.
function formatDayTick(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function formatHourTick(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return formatHourLabel(d.getUTCHours())
}

function exportCsv(data: ManagementData, guildName: string, timeframe: Timeframe) {
  const headers = [
    'Name', 'Role', 'Warnings', 'Timeouts', 'Kicks', 'Bans', 'Unbans', 'Moderation Total',
    'Tickets Handled', 'Tickets Resolved', 'Avg First Response (s)', 'Avg Resolution (s)',
    'Announcements', 'Giveaways', 'Events Created', 'Active Days', 'Consistency %', 'Total Actions', 'Last Active', 'Inactive',
  ]
  const escape = (v: string | number | null) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = data.staff.map((s) =>
    [
      s.name, s.role, s.warnings, s.timeouts, s.kicks, s.bans, s.unbans, s.moderationTotal,
      s.ticketsHandled, s.ticketsResolved, s.avgFirstResponseSeconds ?? '', s.avgResolutionSeconds ?? '',
      s.announcements, s.giveaways, s.eventsCreated, s.activeDays, s.consistencyPct, s.totalActions,
      s.lastActiveAt ?? '', s.isInactive ? 'yes' : 'no',
    ].map(escape).join(','),
  )
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${guildName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-management-${timeframe}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
