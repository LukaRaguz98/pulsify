// Server Insights — shared types, trend maths, categorisation metadata and the
// pure recommendation engine that turns raw server signals into prioritised,
// actionable recommendations.
//
// Like lib/automations.ts and lib/onboarding.ts this module is framework-free:
// icons are referenced by lucide name (resolved in the UI layer) and there is
// no JSX, so the rules stay trivially testable and the same Recommendation
// shape can later be produced by Pulse instead of (or alongside) these rules.

import { formatDuration, type TimeseriesPoint } from '@/lib/analytics'

// ── Categorisation ───────────────────────────────────────────────────────────

/** The five lenses every insight is filed under. */
export type InsightCategory = 'growth' | 'moderation' | 'activity' | 'security' | 'optimization'

export const CATEGORY_META: Record<
  InsightCategory,
  { label: string; icon: string; accent: string; order: number }
> = {
  growth: { label: 'Growth', icon: 'TrendingUp', accent: '#10b981', order: 0 },
  activity: { label: 'Activity', icon: 'Activity', accent: 'var(--p-1)', order: 1 },
  moderation: { label: 'Moderation', icon: 'ShieldAlert', accent: '#f87171', order: 2 },
  security: { label: 'Security', icon: 'Lock', accent: '#f59e0b', order: 3 },
  optimization: { label: 'Optimization', icon: 'Sparkles', accent: '#22d3ee', order: 4 },
}

export const INSIGHT_CATEGORIES = Object.keys(CATEGORY_META) as InsightCategory[]

// ── Severity / priority ───────────────────────────────────────────────────────

/** Priority of a recommendation — drives ordering and the colour of its chip. */
export type InsightSeverity = 'critical' | 'warning' | 'suggestion' | 'positive'

export const SEVERITY_META: Record<
  InsightSeverity,
  { label: string; icon: string; accent: string; rank: number }
> = {
  critical: { label: 'Critical', icon: 'AlertOctagon', accent: '#ef4444', rank: 0 },
  warning: { label: 'Needs attention', icon: 'AlertTriangle', accent: '#f59e0b', rank: 1 },
  suggestion: { label: 'Suggestion', icon: 'Lightbulb', accent: 'var(--p-1)', rank: 2 },
  positive: { label: 'Looking good', icon: 'CheckCircle2', accent: '#10b981', rank: 3 },
}

// ── Trends ─────────────────────────────────────────────────────────────────────

export type TrendDirection = 'increasing' | 'decreasing' | 'stable'

export type Trend = {
  direction: TrendDirection
  /** Signed percentage change vs the previous comparable window (rounded, capped). */
  changePct: number
  /** Previous period had no activity, so a percentage is meaningless — show "New". */
  isNew?: boolean
}

// Below this absolute % change a movement is treated as flat noise rather than
// a real trend — keeps tiny week-to-week wiggles from showing arrows.
const STABLE_THRESHOLD_PCT = 8
// A tiny prior baseline makes percentages explode (3 → 373 reads as "+12333%"),
// which looks like a bug. Bound the displayed magnitude so it stays sane.
const MAX_CHANGE_PCT = 999

/**
 * Percentage change of `current` vs `previous`, classified into a direction.
 * When the previous window had no activity, a ratio is undefined, so it's
 * flagged `isNew` (rendered as "New") rather than a fake percentage. Otherwise
 * the magnitude is capped at ±MAX_CHANGE_PCT so a tiny baseline can't produce a
 * runaway number.
 */
export function computeTrend(current: number, previous: number): Trend {
  if (previous <= 0) {
    if (current <= 0) return { direction: 'stable', changePct: 0 }
    return { direction: 'increasing', changePct: 0, isNew: true }
  }
  const raw = Math.round(((current - previous) / previous) * 100)
  const changePct = Math.max(-MAX_CHANGE_PCT, Math.min(MAX_CHANGE_PCT, raw))
  if (Math.abs(changePct) < STABLE_THRESHOLD_PCT) return { direction: 'stable', changePct }
  return { direction: changePct > 0 ? 'increasing' : 'decreasing', changePct }
}

export type TimeseriesTotals = {
  messages: number
  joins: number
  leaves: number
  commands: number
  mod_actions: number
  voice_seconds: number
}

function emptyTotals(): TimeseriesTotals {
  return { messages: 0, joins: 0, leaves: 0, commands: 0, mod_actions: 0, voice_seconds: 0 }
}

function addPoint(acc: TimeseriesTotals, p: TimeseriesPoint): void {
  acc.messages += Number(p.messages)
  acc.joins += Number(p.joins)
  acc.leaves += Number(p.leaves)
  acc.commands += Number(p.commands)
  acc.mod_actions += Number(p.mod_actions)
  acc.voice_seconds += Number(p.voice_seconds)
}

/**
 * Split a 2×window timeseries into the most recent `windowDays` ("current") and
 * the window immediately before it ("previous"), summing each. Buckets are
 * placed by their own timestamp so gaps (days the RPC returns no row for) count
 * as zero rather than shifting the boundary.
 */
export function splitWindow(
  series: TimeseriesPoint[],
  windowDays: number,
  now: number = Date.now(),
): { current: TimeseriesTotals; previous: TimeseriesTotals } {
  const windowMs = windowDays * 86_400_000
  const cutoff = now - windowMs
  const floor = now - windowMs * 2
  const current = emptyTotals()
  const previous = emptyTotals()
  for (const p of series) {
    const t = new Date(p.bucket).getTime()
    if (t >= cutoff) addPoint(current, p)
    else if (t >= floor) addPoint(previous, p)
  }
  return { current, previous }
}

/** The six headline trends shown in the engagement overview. */
export type InsightTrends = {
  messages: Trend
  voice_seconds: Trend
  joins: Trend
  netGrowth: Trend
  mod_actions: Trend
  commands: Trend
}

export function computeTrends(
  current: TimeseriesTotals,
  previous: TimeseriesTotals,
): InsightTrends {
  return {
    messages: computeTrend(current.messages, previous.messages),
    voice_seconds: computeTrend(current.voice_seconds, previous.voice_seconds),
    joins: computeTrend(current.joins, previous.joins),
    netGrowth: computeTrend(current.joins - current.leaves, previous.joins - previous.leaves),
    mod_actions: computeTrend(current.mod_actions, previous.mod_actions),
    commands: computeTrend(current.commands, previous.commands),
  }
}

// ── Recommendations ─────────────────────────────────────────────────────────

/** A quick-fix link, relative to `/dashboard/{guildId}`. */
export type RecommendationAction = { label: string; path: string }

export type Recommendation = {
  /** Stable id, unique within a single response. */
  id: string
  category: InsightCategory
  severity: InsightSeverity
  /** Short headline. */
  title: string
  /** One or two sentences explaining the finding. */
  detail: string
  /** lucide icon name, resolved in the UI. */
  icon: string
  /** Optional deep-link to the place that fixes it. */
  action?: RecommendationAction
  /** Where this came from — the rule engine today, Pulse in future. */
  source: 'rule' | 'ai'
}

export type InactiveChannel = { id: string; name: string; daysInactive: number }
export type UnusedRole = { id: string; name: string; color: number }
export type DangerousRole = {
  id: string
  name: string
  color: number
  /** Display labels of the dangerous permissions this role grants. */
  permissions: string[]
}

export type OnboardingStatusSignal = 'completed' | 'in_progress' | 'skipped' | 'not_started'

/**
 * Everything the rule engine needs, already reduced from Discord + Supabase by
 * the API route. Keeping the engine's input a plain data object (no I/O) is what
 * makes the rules portable to the future Pulse pipeline.
 */
export type InsightSignals = {
  windowDays: number
  current: TimeseriesTotals
  previous: TimeseriesTotals
  trends: InsightTrends
  activeUsers: number
  totalMembers: number
  inactiveChannels: InactiveChannel[]
  unusedRoles: UnusedRole[]
  /** null when membership couldn't be fully sampled (very large servers). */
  unusedRolesReliable: boolean
  dangerousRoles: DangerousRole[]
  pulseGuardEnabled: boolean
  welcomeConfigured: boolean
  onboardingStatus: OnboardingStatusSignal
  /** Busiest day×hour from the heatmap; null when unavailable. */
  peakActivitySlot: { dow: number; hour: number } | null
}

// A mod-action surge only matters once there's a meaningful baseline of actions
// — otherwise 1→3 actions reads as "+200%" on a quiet server.
const MOD_SPIKE_MIN_ACTIONS = 5
const MOD_SPIKE_PCT = 50
// Voice/engagement movements we consider worth calling out explicitly.
const VOICE_SURGE_PCT = 25
const ENGAGEMENT_DROP_PCT = 20
// Only surface individual cards for the worst few of a noisy category.
const MAX_DANGEROUS_ROLE_CARDS = 4
// Don't suggest a "best time" until there's enough message history for the
// peak day×hour cell to be meaningful rather than a single fluke.
const BEST_TIME_MIN_MESSAGES = 20

// Mon-first weekday names matching the heatmap's `dow` (0 = Monday).
const WEEKDAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function hourLabel(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}

function pctLabel(t: Trend): string {
  const sign = t.changePct > 0 ? '+' : ''
  return `${sign}${t.changePct}%`
}

/**
 * Turn reduced server signals into a prioritised list of recommendations.
 * Pure and deterministic: the same signals always yield the same cards, in the
 * same order (severity first, then category order, then title).
 */
export function generateRecommendations(s: InsightSignals): Recommendation[] {
  const recs: Recommendation[] = []
  const period = `the last ${s.windowDays} days`

  // ── Security ────────────────────────────────────────────────────────────────
  for (const role of s.dangerousRoles.slice(0, MAX_DANGEROUS_ROLE_CARDS)) {
    recs.push({
      id: `danger-role-${role.id}`,
      category: 'security',
      severity: 'warning',
      title: `“${role.name}” has dangerous permissions`,
      detail: `This role grants ${listPerms(role.permissions)}. Review who holds it — these permissions can compromise the server if misassigned.`,
      icon: 'ShieldX',
      action: { label: 'Review roles', path: '/roles' },
      source: 'rule',
    })
  }
  if (s.dangerousRoles.length > MAX_DANGEROUS_ROLE_CARDS) {
    const extra = s.dangerousRoles.length - MAX_DANGEROUS_ROLE_CARDS
    recs.push({
      id: 'danger-role-more',
      category: 'security',
      severity: 'suggestion',
      title: `${extra} more role${extra === 1 ? '' : 's'} with risky permissions`,
      detail: 'Several other roles also grant high-impact permissions. Audit your role hierarchy to keep elevated access to a minimum.',
      icon: 'Lock',
      action: { label: 'Review roles', path: '/roles' },
      source: 'rule',
    })
  }

  // ── Moderation ────────────────────────────────────────────────────────────────
  if (!s.pulseGuardEnabled) {
    recs.push({
      id: 'enable-pulse-guard',
      category: 'moderation',
      severity: 'suggestion',
      title: 'Turn on AutoMod with Pulse Guard',
      detail: 'Pulse Guard isn’t active. Enable it to automatically catch spam, scam links and toxicity before your moderators have to.',
      icon: 'ShieldAlert',
      action: { label: 'Enable Pulse Guard', path: '/ai-moderation' },
      source: 'rule',
    })
  }
  if (
    s.trends.mod_actions.direction === 'increasing' &&
    s.trends.mod_actions.changePct >= MOD_SPIKE_PCT &&
    s.current.mod_actions >= MOD_SPIKE_MIN_ACTIONS
  ) {
    recs.push({
      id: 'mod-spike',
      category: 'moderation',
      severity: 'warning',
      title: 'Moderation actions are unusually high',
      detail: `Moderation actions are up ${pctLabel(s.trends.mod_actions)} over ${period} (${s.current.mod_actions} total). This can signal a raid, a problem member or a rule that needs clarifying.`,
      icon: 'Flame',
      action: { label: 'Open moderation', path: '/moderation' },
      source: 'rule',
    })
  }

  // ── Growth ──────────────────────────────────────────────────────────────────
  const netGrowth = s.current.joins - s.current.leaves
  if (netGrowth < 0) {
    recs.push({
      id: 'net-negative',
      category: 'growth',
      severity: 'warning',
      title: 'More members left than joined',
      detail: `Over ${period} you gained ${s.current.joins} and lost ${s.current.leaves} members (net ${netGrowth}). Consider a welcome flow, events or announcements to retain new members.`,
      icon: 'TrendingDown',
      action: { label: 'View statistics', path: '/statistics' },
      source: 'rule',
    })
  }
  if (
    s.trends.messages.direction === 'decreasing' &&
    s.trends.messages.changePct <= -ENGAGEMENT_DROP_PCT
  ) {
    recs.push({
      id: 'engagement-decline',
      category: 'growth',
      severity: 'warning',
      title: 'Engagement is trending down',
      detail: `Messages are down ${pctLabel(s.trends.messages)} versus the previous ${s.windowDays} days. Try scheduling an event or a recurring announcement to re-spark activity.`,
      icon: 'Activity',
      action: { label: 'Schedule something', path: '/scheduled' },
      source: 'rule',
    })
  }
  if (!s.welcomeConfigured && s.current.joins > 0) {
    recs.push({
      id: 'setup-welcome',
      category: 'growth',
      severity: 'suggestion',
      title: 'Greet your new members',
      detail: `${s.current.joins} member${s.current.joins === 1 ? '' : 's'} joined over ${period}, but no welcome message is set up. A warm greeting boosts first-day retention.`,
      icon: 'Hand',
      action: { label: 'Set up welcome', path: '/automations' },
      source: 'rule',
    })
  }

  // ── Activity ──────────────────────────────────────────────────────────────────
  if (
    s.trends.voice_seconds.direction === 'increasing' &&
    s.trends.voice_seconds.changePct >= VOICE_SURGE_PCT &&
    s.current.voice_seconds > 0
  ) {
    recs.push({
      id: 'voice-surge',
      category: 'activity',
      severity: 'positive',
      title: `Voice activity increased by ${s.trends.voice_seconds.changePct}%`,
      detail: 'Members are spending more time in voice. Lean into it with voice events or a dedicated hangout channel while interest is high.',
      icon: 'Mic',
      action: { label: 'Create an event', path: '/events?new=1' },
      source: 'rule',
    })
  }
  if (s.peakActivitySlot && s.current.messages >= BEST_TIME_MIN_MESSAGES) {
    const { dow, hour } = s.peakActivitySlot
    recs.push({
      id: 'best-time',
      category: 'activity',
      severity: 'suggestion',
      title: 'Post when your members are online',
      detail: `Your server is most active on ${WEEKDAY_LABELS[dow]}s around ${hourLabel(hour)} (UTC). Schedule announcements or events for then to reach the most people.`,
      icon: 'Clock',
      action: { label: 'Schedule for peak time', path: '/scheduled' },
      source: 'rule',
    })
  }

  // ── Optimization ──────────────────────────────────────────────────────────────
  if (s.inactiveChannels.length > 0) {
    const names = s.inactiveChannels.slice(0, 3).map((c) => `#${c.name}`).join(', ')
    const more = s.inactiveChannels.length - 3
    recs.push({
      id: 'inactive-channels',
      category: 'optimization',
      severity: 'suggestion',
      title: `${s.inactiveChannels.length} channel${s.inactiveChannels.length === 1 ? ' looks' : 's look'} inactive`,
      detail: `${names}${more > 0 ? ` and ${more} more` : ''} ${s.inactiveChannels.length === 1 ? 'has' : 'have'} seen no messages in weeks. Archiving or merging quiet channels keeps your server easy to navigate.`,
      icon: 'Hash',
      action: { label: 'Manage channels', path: '/channels' },
      source: 'rule',
    })
  }
  if (s.unusedRolesReliable && s.unusedRoles.length > 0) {
    const names = s.unusedRoles.slice(0, 3).map((r) => r.name).join(', ')
    const more = s.unusedRoles.length - 3
    recs.push({
      id: 'unused-roles',
      category: 'optimization',
      severity: 'suggestion',
      title: `${s.unusedRoles.length} role${s.unusedRoles.length === 1 ? ' has' : 's have'} no members`,
      detail: `${names}${more > 0 ? ` and ${more} more` : ''} ${s.unusedRoles.length === 1 ? 'is' : 'are'} assigned to nobody. Removing unused roles declutters the role list and your permission model.`,
      icon: 'Users',
      action: { label: 'Manage roles', path: '/roles' },
      source: 'rule',
    })
  }
  if (s.onboardingStatus !== 'completed') {
    const notStarted = s.onboardingStatus === 'not_started'
    recs.push({
      id: 'finish-onboarding',
      category: 'optimization',
      severity: 'suggestion',
      title: notStarted ? 'Run the first-time setup' : 'Your onboarding setup is incomplete',
      detail: notStarted
        ? 'You haven’t run Pulsify’s guided setup yet. It configures moderation, welcomes and analytics with sensible defaults in a couple of minutes.'
        : 'You started the setup wizard but didn’t finish. Complete it to make sure your core features are configured.',
      icon: 'Rocket',
      action: { label: notStarted ? 'Start setup' : 'Resume setup', path: '/onboarding' },
      source: 'rule',
    })
  }

  // ── Positive fallback ──────────────────────────────────────────────────────────
  // If nothing needs attention, reassure rather than show an empty board.
  const hasConcern = recs.some((r) => r.severity === 'critical' || r.severity === 'warning')
  if (!hasConcern) {
    recs.push({
      id: 'all-clear',
      category: 'activity',
      severity: 'positive',
      title: 'Your server looks healthy',
      detail: 'No pressing issues right now. Activity, moderation and structure are all in good shape — keep it up!',
      icon: 'CheckCircle2',
      source: 'rule',
    })
  }

  return sortRecommendations(recs)
}

function listPerms(perms: string[]): string {
  if (perms.length === 0) return 'elevated permissions'
  if (perms.length === 1) return perms[0]
  if (perms.length === 2) return `${perms[0]} and ${perms[1]}`
  return `${perms.slice(0, -1).join(', ')} and ${perms[perms.length - 1]}`
}

/** Severity first (critical→positive), then category order, then title. */
export function sortRecommendations(recs: Recommendation[]): Recommendation[] {
  return [...recs].sort((a, b) => {
    const sev = SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank
    if (sev !== 0) return sev
    const cat = CATEGORY_META[a.category].order - CATEGORY_META[b.category].order
    if (cat !== 0) return cat
    return a.title.localeCompare(b.title)
  })
}

// ── Health score ────────────────────────────────────────────────────────────

export type HealthBand = 'excellent' | 'healthy' | 'fair' | 'attention'

export type HealthScore = {
  score: number
  band: HealthBand
  label: string
  accent: string
}

const SEVERITY_PENALTY: Record<InsightSeverity, number> = {
  critical: 18,
  warning: 9,
  suggestion: 2,
  positive: 0,
}

/**
 * Derive a 0–100 health score from the surfaced recommendations, so the
 * headline number can never disagree with the cards beneath it. Heavily-flagged
 * servers score lower; an all-clear board scores 100.
 */
export function healthFromRecommendations(recs: Recommendation[]): HealthScore {
  let score = 100
  for (const r of recs) score -= SEVERITY_PENALTY[r.severity]
  score = Math.max(5, Math.min(100, score))

  let band: HealthBand
  if (score >= 85) band = 'excellent'
  else if (score >= 65) band = 'healthy'
  else if (score >= 45) band = 'fair'
  else band = 'attention'

  const meta: Record<HealthBand, { label: string; accent: string }> = {
    excellent: { label: 'Excellent', accent: '#10b981' },
    healthy: { label: 'Healthy', accent: 'var(--p-1)' },
    fair: { label: 'Fair', accent: '#f59e0b' },
    attention: { label: 'Needs attention', accent: '#ef4444' },
  }
  return { score, band, ...meta[band] }
}

// ── API payload ────────────────────────────────────────────────────────────

export type TopChannelLite = { channel_id: string; channel_name: string | null; message_count: number }

/** One day-of-week × hour-of-day message tally for the activity heatmap. */
export type HeatmapCell = { dow: number; hour: number; message_count: number }

/** The full response the /insights route returns and the UI renders. */
export type InsightsData = {
  generatedAt: string
  windowDays: number
  /** Whether any activity at all was recorded in the window. */
  hasActivity: boolean
  health: HealthScore
  overview: {
    current: TimeseriesTotals
    /** Totals for the window immediately before `current`, for comparison. */
    previous: TimeseriesTotals
    trends: InsightTrends
    activeUsers: number
    totalMembers: number
  }
  /** 2×window daily buckets — used for the day-of-week activity pattern. */
  series: TimeseriesPoint[]
  /** Busiest channels in the window — drives the activity-concentration vital. */
  topChannels: TopChannelLite[]
  /** Day×hour message tallies for the Peak Activity Map. Empty if unavailable. */
  heatmap: HeatmapCell[]
  /** Trailing window (days) the heatmap is computed over. */
  heatmapDays: number
  inactiveChannels: InactiveChannel[]
  unusedRoles: UnusedRole[]
  unusedRolesReliable: boolean
  dangerousRoles: DangerousRole[]
  recommendations: Recommendation[]
  /** Text/announcement channels the recap can be posted to. */
  postableChannels: { id: string; name: string }[]
}

/** The single busiest day×hour cell, or null when there's no message data. */
export function bestActivitySlot(cells: HeatmapCell[]): { dow: number; hour: number } | null {
  let best: HeatmapCell | null = null
  for (const c of cells) {
    const count = Number(c.message_count)
    if (count > 0 && (!best || count > Number(best.message_count))) best = c
  }
  return best ? { dow: best.dow, hour: best.hour } : null
}

// ── Shareable recap ────────────────────────────────────────────────────────

/** Minimal shape the recap builder needs — assembled by both the UI and the
 *  server action that posts to Discord, so on-page and posted text always match. */
export type RecapInput = {
  windowDays: number
  current: TimeseriesTotals
  trends: InsightTrends
  activeUsers: number
  totalMembers: number
  peakSlot: { dow: number; hour: number } | null
  topChannel: string | null
}

function trendPhrase(t: Trend): string {
  if (t.isNew) return '(new)'
  if (t.direction === 'stable') return '(steady)'
  return t.direction === 'increasing'
    ? `(up ${Math.abs(t.changePct)}%)`
    : `(down ${Math.abs(t.changePct)}%)`
}

/** One labelled line of the recap. */
export type RecapItem = { label: string; value: string }

/**
 * Structured label/value highlights summarising the period. Rendered with bold
 * labels both on the page and inside the Discord V2 embed — professional, no
 * emoji clutter. Quiet categories (no voice, no mod actions) are omitted.
 */
export function buildRecap(i: RecapInput): RecapItem[] {
  const items: RecapItem[] = []
  const net = i.current.joins - i.current.leaves
  items.push({
    label: 'Members',
    value: `${net >= 0 ? '+' : ''}${net} net — ${i.current.joins} joined, ${i.current.leaves} left ${trendPhrase(i.trends.netGrowth)}`,
  })
  items.push({
    label: 'Messages',
    value: `${i.current.messages.toLocaleString()} ${trendPhrase(i.trends.messages)}`,
  })
  if (i.current.voice_seconds > 0) {
    items.push({
      label: 'Voice',
      value: `${formatDuration(i.current.voice_seconds)} ${trendPhrase(i.trends.voice_seconds)}`,
    })
  }
  if (i.totalMembers > 0) {
    const pct = Math.min(100, Math.round((i.activeUsers / i.totalMembers) * 100))
    items.push({
      label: 'Active members',
      value: `${i.activeUsers.toLocaleString()} (${pct}% of the server)`,
    })
  }
  if (i.peakSlot) {
    items.push({
      label: 'Peak activity',
      value: `${WEEKDAY_LABELS[i.peakSlot.dow]}s around ${hourLabel(i.peakSlot.hour)}`,
    })
  }
  if (i.topChannel) items.push({ label: 'Top channel', value: `#${i.topChannel}` })
  if (i.current.mod_actions > 0) {
    items.push({
      label: 'Moderation',
      value: `${i.current.mod_actions} action${i.current.mod_actions === 1 ? '' : 's'} taken`,
    })
  }
  return items
}

export const INSIGHT_WINDOWS = [7, 30] as const
export type InsightWindow = (typeof INSIGHT_WINDOWS)[number]

export function isInsightWindow(n: number): n is InsightWindow {
  return (INSIGHT_WINDOWS as readonly number[]).includes(n)
}
