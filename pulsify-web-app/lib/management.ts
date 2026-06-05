// Management Analytics (PULSIFY-38) — shared types, staff aggregation, support
// timing maths, rankings/leaderboards and the management-insight engine.
//
// Like lib/insights.ts and lib/automations.ts this module is framework-free:
// icons are referenced by lucide name (resolved in the UI layer) and there is no
// JSX or IO, so the maths stays trivially testable. Where Insights interprets
// server-wide activity, Management Analytics interprets the *people running the
// server* — every metric here is attributed to a staff member.

import { computeTrend, type Trend } from '@/lib/insights'
import { timeframeWindowDays, type Timeframe } from '@/lib/analytics'

// ── Windows ──────────────────────────────────────────────────────────────────
//
// Management shares the canonical analytics timeframe selector (24h / 7d / 30d /
// all) with Statistics and Insights so the date range ("retention") is identical
// across every analytics view. 24h/7d/30d trend against the equivalent previous
// window; 'all' has no comparable previous period, so trends are suppressed
// (`comparison: false`) and the window spans from the first recorded action.

const DAY_MS = 86_400_000

// ── Action taxonomy ───────────────────────────────────────────────────────────

/** Every attributable management action, normalised to one of these kinds. */
export type StaffActionKind =
  | 'warn'
  | 'timeout'
  | 'kick'
  | 'ban'
  | 'unban'
  | 'mod_other'
  | 'ticket_claim'
  | 'ticket_close'
  | 'ticket_note'
  | 'announcement'
  | 'giveaway'
  | 'event'

/** The three lenses staff work is filed under. */
export type StaffCategory = 'moderation' | 'support' | 'community'

const SUPPORT_KINDS = new Set<StaffActionKind>(['ticket_claim', 'ticket_close', 'ticket_note'])
const COMMUNITY_KINDS = new Set<StaffActionKind>(['announcement', 'giveaway', 'event'])

export function categoryOfKind(kind: StaffActionKind): StaffCategory {
  if (SUPPORT_KINDS.has(kind)) return 'support'
  if (COMMUNITY_KINDS.has(kind)) return 'community'
  return 'moderation'
}

// moderation_logs.action → kind. Anything not listed is a real moderation action
// but doesn't roll up to one of the headline counters (role/nickname/message ops).
const MOD_ACTION_KIND: Record<string, StaffActionKind> = {
  warn: 'warn',
  warning: 'warn',
  timeout: 'timeout',
  kick: 'kick',
  ban: 'ban',
  unban: 'unban',
}
export function modActionKind(action: string): StaffActionKind {
  return MOD_ACTION_KIND[action] ?? 'mod_other'
}

// ── Normalised inputs ──────────────────────────────────────────────────────────

/** One attributed action with a timestamp. The engine's atomic unit. */
export type StaffEvent = {
  actorId: string
  actorName: string | null
  kind: StaffActionKind
  at: string // ISO
}

/**
 * A ticket opened within the current window, pre-joined with its first response
 * and close attribution by the route. Drives the support timing metrics.
 */
export type TicketRecord = {
  id: string
  openedAt: string
  /** Earliest staff response (claim/note). Null = never picked up. */
  firstResponseAt: string | null
  responderId: string | null
  responderName: string | null
  resolved: boolean
  closedAt: string | null
  closedById: string | null
  closedByName: string | null
}

/** Discord enrichment + the known-staff seed (support-role holders). */
export type StaffDirectoryEntry = {
  id: string
  name: string
  avatar: string | null
  /** True when this member holds a configured support role (known staff). */
  isSupportRole: boolean
}

export type ManagementInput = {
  timeframe: Timeframe
  now: number
  /** All attributed events across the trend window (2× windowDays, or all-time). */
  events: StaffEvent[]
  /** Tickets opened within the current window. */
  tickets: TicketRecord[]
  /** Known staff + display enrichment, keyed in by id elsewhere. */
  directory: StaffDirectoryEntry[]
  /** Count of tickets currently open (not yet resolved). */
  openTickets: number
}

// ── Per-staff output ───────────────────────────────────────────────────────────

export type StaffRole = 'moderator' | 'support' | 'administrator' | 'staff'

export const ROLE_META: Record<StaffRole, { label: string; accent: string; icon: string }> = {
  moderator: { label: 'Moderator', accent: '#f87171', icon: 'Shield' },
  support: { label: 'Support', accent: '#22d3ee', icon: 'LifeBuoy' },
  administrator: { label: 'Administrator', accent: '#a78bfa', icon: 'Crown' },
  staff: { label: 'Staff', accent: 'var(--text-3)', icon: 'UserCog' },
}

export type StaffMemberStats = {
  id: string
  name: string
  avatar: string | null
  role: StaffRole
  // Moderation
  warnings: number
  timeouts: number
  kicks: number
  bans: number
  unbans: number
  moderationOther: number
  moderationTotal: number
  // Support
  ticketsHandled: number
  ticketsResolved: number
  avgFirstResponseSeconds: number | null
  avgResolutionSeconds: number | null
  // Community
  announcements: number
  giveaways: number
  eventsCreated: number
  communityTotal: number
  // Activity
  totalActions: number
  lastActiveAt: string | null
  activeDays: number
  consistencyPct: number
  trend: Trend
  isInactive: boolean
}

// Mutable accumulator used while folding events.
type Acc = {
  id: string
  name: string | null
  warnings: number
  timeouts: number
  kicks: number
  bans: number
  unbans: number
  moderationOther: number
  ticketsHandled: number
  ticketsResolved: number
  firstResponseSamples: number[]
  resolutionSamples: number[]
  announcements: number
  giveaways: number
  eventsCreated: number
  totalActions: number
  prevActions: number
  lastActiveAt: number | null
  activeDayKeys: Set<string>
}

function emptyAcc(id: string, name: string | null): Acc {
  return {
    id,
    name,
    warnings: 0,
    timeouts: 0,
    kicks: 0,
    bans: 0,
    unbans: 0,
    moderationOther: 0,
    ticketsHandled: 0,
    ticketsResolved: 0,
    firstResponseSamples: [],
    resolutionSamples: [],
    announcements: 0,
    giveaways: 0,
    eventsCreated: 0,
    totalActions: 0,
    prevActions: 0,
    lastActiveAt: null,
    activeDayKeys: new Set(),
  }
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function average(samples: number[]): number | null {
  if (samples.length === 0) return null
  return Math.round(samples.reduce((s, v) => s + v, 0) / samples.length)
}

/** Pick a staff member's dominant role from their activity mix. */
function deriveRole(moderation: number, support: number, community: number): StaffRole {
  if (moderation === 0 && support === 0 && community === 0) return 'staff'
  if (community >= moderation && community >= support && community > 0) return 'administrator'
  if (support >= moderation && support > 0) return 'support'
  if (moderation > 0) return 'moderator'
  return 'staff'
}

// ── Aggregate output ───────────────────────────────────────────────────────────

export type ManagementTotals = {
  activeStaff: number
  moderationActions: number
  supportActions: number
  communityActions: number
  totalActions: number
  trends: {
    totalActions: Trend
    moderationActions: Trend
    supportActions: Trend
    communityActions: Trend
    activeStaff: Trend
  }
}

export type SupportSummary = {
  ticketsHandled: number
  ticketsResolved: number
  resolutionRatePct: number
  avgFirstResponseSeconds: number | null
  avgResolutionSeconds: number | null
  openTickets: number
}

export type LeaderboardEntry = { id: string; name: string; avatar: string | null; value: number; unit: string }
export type Leaderboards = {
  topContributor: LeaderboardEntry | null
  mostActiveModerator: LeaderboardEntry | null
  mostActiveSupport: LeaderboardEntry | null
  mostActiveAdministrator: LeaderboardEntry | null
  fastestResponder: LeaderboardEntry | null
  mostTicketsResolved: LeaderboardEntry | null
}

export type ManagementInsightKind = 'overloaded' | 'inactive' | 'exceptional' | 'bottleneck' | 'balance' | 'positive'
export type ManagementSeverity = 'critical' | 'warning' | 'suggestion' | 'positive'

export type ManagementInsight = {
  id: string
  kind: ManagementInsightKind
  severity: ManagementSeverity
  title: string
  body: string
  icon: string
  staffId?: string
}

export const INSIGHT_SEVERITY_META: Record<ManagementSeverity, { label: string; accent: string; rank: number }> = {
  critical: { label: 'Critical', accent: '#ef4444', rank: 0 },
  warning: { label: 'Needs attention', accent: '#f59e0b', rank: 1 },
  suggestion: { label: 'Suggestion', accent: 'var(--p-1)', rank: 2 },
  positive: { label: 'Looking good', accent: '#10b981', rank: 3 },
}

export type TimelineGranularity = 'hour' | 'day'
/** `date` is the ISO timestamp at the start of the bucket. */
export type TimelinePoint = { date: string; moderation: number; support: number; community: number }
export type ContributionSlice = { category: StaffCategory; label: string; value: number; accent: string }

export type ManagementData = {
  generatedAt: string
  timeframe: Timeframe
  /** Effective window length in days (derived from the data for 'all'). */
  windowDays: number
  /** False for 'all' — there's no previous period to trend against. */
  comparison: boolean
  hasActivity: boolean
  totals: ManagementTotals
  staff: StaffMemberStats[]
  leaderboards: Leaderboards
  support: SupportSummary
  insights: ManagementInsight[]
  activityTimeline: TimelinePoint[]
  timelineGranularity: TimelineGranularity
  contributionBreakdown: ContributionSlice[]
}

// ── The engine ─────────────────────────────────────────────────────────────────

export function buildManagement(input: ManagementInput): ManagementData {
  const { timeframe, now, events, tickets, directory, openTickets } = input

  // Resolve the timeframe into a concrete window. For 24h/7d/30d we compare
  // against the equivalent previous window; for 'all' there's no previous period
  // (comparison off) and the window spans from the earliest recorded action so
  // ratios like consistency stay meaningful.
  const fixedDays = timeframeWindowDays(timeframe)
  const comparison = fixedDays !== null
  let earliest = now
  for (const e of events) {
    const t = new Date(e.at).getTime()
    if (!Number.isNaN(t) && t < earliest) earliest = t
  }
  const windowDays = comparison
    ? fixedDays
    : Math.max(1, Math.ceil((now - earliest) / DAY_MS))
  const cutoff = comparison ? now - windowDays * DAY_MS : -Infinity
  const floor = comparison ? now - windowDays * 2 * DAY_MS : -Infinity

  const dir = new Map(directory.map((d) => [d.id, d]))
  const accs = new Map<string, Acc>()
  const accFor = (id: string, name: string | null): Acc => {
    let a = accs.get(id)
    if (!a) {
      a = emptyAcc(id, name ?? dir.get(id)?.name ?? null)
      accs.set(id, a)
    } else if (!a.name && name) {
      a.name = name
    }
    return a
  }

  // Seed known support staff so a zero-activity moderator still surfaces (and can
  // be flagged inactive) rather than vanishing from the roster.
  for (const d of directory) {
    if (d.isSupportRole) accFor(d.id, d.name)
  }

  // ── Fold the event stream ──────────────────────────────────────────────────
  // Aggregate-level category totals, split into current vs previous windows so
  // the headline trends compare like-for-like periods.
  let curMod = 0
  let curSup = 0
  let curCom = 0
  let prevMod = 0
  let prevSup = 0
  let prevCom = 0

  for (const e of events) {
    const t = new Date(e.at).getTime()
    if (Number.isNaN(t) || t < floor) continue
    const isCurrent = t >= cutoff
    const cat = categoryOfKind(e.kind)
    if (isCurrent) {
      if (cat === 'moderation') curMod++
      else if (cat === 'support') curSup++
      else curCom++
    } else {
      if (cat === 'moderation') prevMod++
      else if (cat === 'support') prevSup++
      else prevCom++
    }

    const a = accFor(e.actorId, e.actorName)
    if (!isCurrent) {
      a.prevActions++
      continue
    }
    // Current-window per-staff counters.
    a.totalActions++
    a.activeDayKeys.add(dayKey(t))
    if (a.lastActiveAt === null || t > a.lastActiveAt) a.lastActiveAt = t
    switch (e.kind) {
      case 'warn':
        a.warnings++
        break
      case 'timeout':
        a.timeouts++
        break
      case 'kick':
        a.kicks++
        break
      case 'ban':
        a.bans++
        break
      case 'unban':
        a.unbans++
        break
      case 'mod_other':
        a.moderationOther++
        break
      case 'announcement':
        a.announcements++
        break
      case 'giveaway':
        a.giveaways++
        break
      case 'event':
        a.eventsCreated++
        break
      // ticket_* counters come from the ticket records below, not the raw events,
      // so handling time can be attributed; the events still feed activity/trend.
      default:
        break
    }
  }

  // ── Support timing from ticket records ──────────────────────────────────────
  const globalFirstResponse: number[] = []
  const globalResolution: number[] = []
  let ticketsHandledTotal = 0
  let ticketsResolvedTotal = 0

  for (const tk of tickets) {
    const opened = new Date(tk.openedAt).getTime()
    if (tk.firstResponseAt && tk.responderId) {
      const responded = new Date(tk.firstResponseAt).getTime()
      const secs = Math.max(0, Math.round((responded - opened) / 1000))
      const a = accFor(tk.responderId, tk.responderName)
      a.ticketsHandled++
      a.firstResponseSamples.push(secs)
      globalFirstResponse.push(secs)
      ticketsHandledTotal++
    }
    if (tk.resolved && tk.closedAt && tk.closedById) {
      const closed = new Date(tk.closedAt).getTime()
      const secs = Math.max(0, Math.round((closed - opened) / 1000))
      const a = accFor(tk.closedById, tk.closedByName)
      a.ticketsResolved++
      a.resolutionSamples.push(secs)
      globalResolution.push(secs)
      ticketsResolvedTotal++
    }
  }

  // ── Materialise per-staff stats ─────────────────────────────────────────────
  // A member counts as inactive once they've gone quiet for over half the window
  // (but only if they're known staff or were active in the previous period —
  // otherwise a one-off actor isn't "staff" worth flagging).
  const inactivityCutoff = now - Math.ceil(windowDays / 2) * DAY_MS

  const staff: StaffMemberStats[] = []
  for (const a of accs.values()) {
    const moderationTotal = a.warnings + a.timeouts + a.kicks + a.bans + a.unbans + a.moderationOther
    const communityTotal = a.announcements + a.giveaways + a.eventsCreated
    const supportTotal = a.ticketsHandled + a.ticketsResolved
    const known = dir.get(a.id)?.isSupportRole ?? false

    const isInactive =
      (known || a.prevActions > 0) &&
      (a.lastActiveAt === null || a.lastActiveAt < inactivityCutoff)

    staff.push({
      id: a.id,
      name: a.name ?? `User ${a.id.slice(-4)}`,
      avatar: dir.get(a.id)?.avatar ?? null,
      role: deriveRole(moderationTotal, supportTotal, communityTotal),
      warnings: a.warnings,
      timeouts: a.timeouts,
      kicks: a.kicks,
      bans: a.bans,
      unbans: a.unbans,
      moderationOther: a.moderationOther,
      moderationTotal,
      ticketsHandled: a.ticketsHandled,
      ticketsResolved: a.ticketsResolved,
      avgFirstResponseSeconds: average(a.firstResponseSamples),
      avgResolutionSeconds: average(a.resolutionSamples),
      announcements: a.announcements,
      giveaways: a.giveaways,
      eventsCreated: a.eventsCreated,
      communityTotal,
      totalActions: a.totalActions,
      lastActiveAt: a.lastActiveAt ? new Date(a.lastActiveAt).toISOString() : null,
      activeDays: a.activeDayKeys.size,
      consistencyPct: Math.min(100, Math.round((a.activeDayKeys.size / windowDays) * 100)),
      trend: computeTrend(a.totalActions, a.prevActions),
      isInactive,
    })
  }

  // Top contributors first; ties broken by who's been active more recently.
  staff.sort((x, y) => y.totalActions - x.totalActions || lastActiveMs(y) - lastActiveMs(x))

  // ── Totals + trends ─────────────────────────────────────────────────────────
  const activeStaff = staff.filter((s) => s.totalActions > 0).length
  const prevActiveStaff = countPrevActive(accs)
  const curTotal = curMod + curSup + curCom
  const prevTotal = prevMod + prevSup + prevCom

  const totals: ManagementTotals = {
    activeStaff,
    moderationActions: curMod,
    supportActions: curSup,
    communityActions: curCom,
    totalActions: curTotal,
    trends: {
      totalActions: computeTrend(curTotal, prevTotal),
      moderationActions: computeTrend(curMod, prevMod),
      supportActions: computeTrend(curSup, prevSup),
      communityActions: computeTrend(curCom, prevCom),
      activeStaff: computeTrend(activeStaff, prevActiveStaff),
    },
  }

  // ── Support summary ─────────────────────────────────────────────────────────
  const support: SupportSummary = {
    ticketsHandled: ticketsHandledTotal,
    ticketsResolved: ticketsResolvedTotal,
    resolutionRatePct:
      tickets.length > 0 ? Math.round((ticketsResolvedTotal / tickets.length) * 100) : 0,
    avgFirstResponseSeconds: average(globalFirstResponse),
    avgResolutionSeconds: average(globalResolution),
    openTickets,
  }

  // ── Leaderboards ────────────────────────────────────────────────────────────
  const leaderboards = buildLeaderboards(staff)

  // ── Timeline + contribution breakdown ───────────────────────────────────────
  const activityTimeline = buildTimeline(events, windowDays, now)
  const granularity: TimelineGranularity = windowDays <= 1 ? 'hour' : 'day'
  const contributionBreakdown: ContributionSlice[] = [
    { category: 'moderation', label: 'Moderation', value: curMod, accent: '#f87171' },
    { category: 'support', label: 'Support', value: curSup, accent: '#22d3ee' },
    { category: 'community', label: 'Community', value: curCom, accent: '#a78bfa' },
  ]

  // ── Insights ────────────────────────────────────────────────────────────────
  const insights = generateManagementInsights(staff, support, totals, windowDays)

  return {
    generatedAt: new Date(now).toISOString(),
    timeframe,
    windowDays,
    comparison,
    hasActivity: curTotal > 0 || prevTotal > 0,
    totals,
    staff,
    leaderboards,
    support,
    insights,
    activityTimeline,
    timelineGranularity: granularity,
    contributionBreakdown,
  }
}

function lastActiveMs(s: StaffMemberStats): number {
  return s.lastActiveAt ? new Date(s.lastActiveAt).getTime() : 0
}

function countPrevActive(accs: Map<string, Acc>): number {
  let n = 0
  for (const a of accs.values()) if (a.prevActions > 0) n++
  return n
}

function entryOf(s: StaffMemberStats | undefined, value: number, unit: string): LeaderboardEntry | null {
  if (!s) return null
  return { id: s.id, name: s.name, avatar: s.avatar, value, unit }
}

function buildLeaderboards(staff: StaffMemberStats[]): Leaderboards {
  const maxBy = (sel: (s: StaffMemberStats) => number): StaffMemberStats | undefined => {
    let best: StaffMemberStats | undefined
    for (const s of staff) {
      if (sel(s) <= 0) continue
      if (!best || sel(s) > sel(best)) best = s
    }
    return best
  }
  const topContributor = maxBy((s) => s.totalActions)
  const mostMod = maxBy((s) => s.moderationTotal)
  const mostSup = maxBy((s) => s.ticketsHandled)
  const mostAdmin = maxBy((s) => s.communityTotal)
  const mostResolved = maxBy((s) => s.ticketsResolved)

  // Fastest responder = lowest average first-response, among those who actually
  // responded to at least two tickets (one sample is noise, not a track record).
  let fastest: StaffMemberStats | undefined
  for (const s of staff) {
    if (s.avgFirstResponseSeconds === null || s.ticketsHandled < 2) continue
    if (!fastest || (s.avgFirstResponseSeconds < (fastest.avgFirstResponseSeconds ?? Infinity))) fastest = s
  }

  return {
    topContributor: entryOf(topContributor, topContributor?.totalActions ?? 0, 'actions'),
    mostActiveModerator: entryOf(mostMod, mostMod?.moderationTotal ?? 0, 'actions'),
    mostActiveSupport: entryOf(mostSup, mostSup?.ticketsHandled ?? 0, 'tickets'),
    mostActiveAdministrator: entryOf(mostAdmin, mostAdmin?.communityTotal ?? 0, 'actions'),
    fastestResponder: entryOf(fastest, fastest?.avgFirstResponseSeconds ?? 0, 'avg response'),
    mostTicketsResolved: entryOf(mostResolved, mostResolved?.ticketsResolved ?? 0, 'resolved'),
  }
}

const HOUR_MS = 3_600_000
// Cap the number of seeded buckets so an all-time view over months of data
// doesn't produce thousands of points — the chart shows the most recent span.
const MAX_DAILY_BUCKETS = 120

/**
 * Continuous activity-by-category series. Buckets hourly for the 24h window
 * (windowDays ≤ 1) and daily otherwise, mirroring Statistics' granularity, with
 * the recent span pre-seeded so the x-axis has no gaps.
 */
function buildTimeline(events: StaffEvent[], windowDays: number, now: number): TimelinePoint[] {
  const hourly = windowDays <= 1
  const stepMs = hourly ? HOUR_MS : DAY_MS
  const count = hourly ? 24 : Math.min(windowDays, MAX_DAILY_BUCKETS)
  const keyOf = (ms: number) => (hourly ? new Date(ms).toISOString().slice(0, 13) : dayKey(ms))

  const buckets = new Map<string, TimelinePoint>()
  for (let i = count - 1; i >= 0; i--) {
    const ms = now - i * stepMs
    buckets.set(keyOf(ms), { date: new Date(ms).toISOString(), moderation: 0, support: 0, community: 0 })
  }
  const start = now - count * stepMs
  for (const e of events) {
    const t = new Date(e.at).getTime()
    if (Number.isNaN(t) || t < start) continue
    const point = buckets.get(keyOf(t))
    if (!point) continue
    point[categoryOfKind(e.kind)]++
  }
  return Array.from(buckets.values())
}

// One-hour SLA before first response is flagged as a bottleneck.
const SLOW_RESPONSE_SECONDS = 3600
// A single staffer carrying this share of the workload is "overloaded".
const OVERLOAD_SHARE = 0.5

function generateManagementInsights(
  staff: StaffMemberStats[],
  support: SupportSummary,
  totals: ManagementTotals,
  windowDays: number,
): ManagementInsight[] {
  const out: ManagementInsight[] = []

  // Overloaded — one person doing most of the work in a category.
  if (totals.moderationActions >= 10) {
    const topMod = staff.reduce((a, b) => (b.moderationTotal > a.moderationTotal ? b : a), staff[0])
    const share = topMod.moderationTotal / totals.moderationActions
    if (share >= OVERLOAD_SHARE && topMod.moderationTotal >= 8) {
      out.push({
        id: 'overloaded-mod',
        kind: 'overloaded',
        severity: 'warning',
        title: `${topMod.name} is carrying moderation`,
        body: `${topMod.name} performed ${Math.round(share * 100)}% of all moderation actions this period. Spread the load across more moderators to avoid burnout.`,
        icon: 'Flame',
        staffId: topMod.id,
      })
    }
  }
  if (support.ticketsHandled >= 6) {
    const topSup = staff.reduce((a, b) => (b.ticketsHandled > a.ticketsHandled ? b : a), staff[0])
    const share = topSup.ticketsHandled / support.ticketsHandled
    if (share >= OVERLOAD_SHARE && topSup.ticketsHandled >= 5) {
      out.push({
        id: 'overloaded-support',
        kind: 'overloaded',
        severity: 'warning',
        title: `${topSup.name} is handling most tickets`,
        body: `${topSup.name} picked up ${Math.round(share * 100)}% of tickets. Consider rebalancing support coverage.`,
        icon: 'LifeBuoy',
        staffId: topSup.id,
      })
    }
  }

  // Bottleneck — slow first response.
  if (support.avgFirstResponseSeconds !== null && support.avgFirstResponseSeconds > SLOW_RESPONSE_SECONDS) {
    out.push({
      id: 'slow-response',
      kind: 'bottleneck',
      severity: 'warning',
      title: 'Support responses are slow',
      body: `The average first response is ${formatSeconds(support.avgFirstResponseSeconds)}. Add coverage during peak hours or set response expectations to keep members from waiting.`,
      icon: 'Clock',
    })
  }
  // Bottleneck — open backlog.
  if (support.openTickets >= 10 && support.openTickets > support.ticketsResolved) {
    out.push({
      id: 'ticket-backlog',
      kind: 'bottleneck',
      severity: 'warning',
      title: 'Tickets are piling up',
      body: `${support.openTickets} tickets are still open — more than were resolved this period. Clear the backlog before response quality slips.`,
      icon: 'Inbox',
    })
  }

  // Inactive staff.
  const inactive = staff.filter((s) => s.isInactive)
  if (inactive.length > 0) {
    out.push({
      id: 'inactive-staff',
      kind: 'inactive',
      severity: 'suggestion',
      title: `${inactive.length} staff member${inactive.length === 1 ? '' : 's'} ${inactive.length === 1 ? 'has' : 'have'} gone quiet`,
      body: `${inactive.slice(0, 4).map((s) => s.name).join(', ')}${inactive.length > 4 ? ` +${inactive.length - 4} more` : ''} ${inactive.length === 1 ? 'has' : 'have'} had little to no activity in the last ${Math.ceil(windowDays / 2)} days. Check in or review their roles.`,
      icon: 'UserMinus',
    })
  }

  // Exceptional contributor — well clear of the pack.
  const active = staff.filter((s) => s.totalActions > 0).sort((a, b) => b.totalActions - a.totalActions)
  if (active.length >= 2 && active[0].totalActions >= 15) {
    const lead = active[0]
    const runnerUp = active[1].totalActions
    if (lead.totalActions >= runnerUp * 2) {
      out.push({
        id: 'exceptional',
        kind: 'exceptional',
        severity: 'positive',
        title: `${lead.name} is your standout this period`,
        body: `${lead.name} logged ${lead.totalActions} actions — more than double the next most active member. Recognise the contribution.`,
        icon: 'Star',
        staffId: lead.id,
      })
    }
  }

  // Balance suggestion — work concentrated in very few hands.
  if (totals.activeStaff > 0 && totals.activeStaff <= 2 && totals.totalActions >= 20) {
    out.push({
      id: 'balance',
      kind: 'balance',
      severity: 'suggestion',
      title: 'Management rests on a few people',
      body: `Only ${totals.activeStaff} staff member${totals.activeStaff === 1 ? '' : 's'} did meaningful work this period. Recruit or empower more staff so the server isn't dependent on a single person.`,
      icon: 'Scale',
    })
  }

  // All-clear.
  if (out.length === 0 && totals.totalActions > 0) {
    out.push({
      id: 'healthy',
      kind: 'positive',
      severity: 'positive',
      title: 'Your team is running smoothly',
      body: 'Workload is well distributed, response times are healthy and staff are active. Keep it up.',
      icon: 'CheckCircle2',
    })
  }

  return out.sort((a, b) => INSIGHT_SEVERITY_META[a.severity].rank - INSIGHT_SEVERITY_META[b.severity].rank)
}

/** Compact human duration for insight copy (e.g. "2h 5m", "45m", "30s"). */
export function formatSeconds(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds <= 0) return '0s'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`
}
