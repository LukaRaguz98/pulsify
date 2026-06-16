// Member Milestones — pure config + metric helpers (PULSIFY-35).
//
// A milestone is a single named threshold on one member metric. Where Levels &
// XP (lib/leveling.ts) rewards a smooth curve, a milestone is a discrete "you
// crossed N" achievement that grants reward roles and a congratulations post.
//
// No JSX / framework / IO imports live here — icons are referenced by lucide
// NAME (resolved in the UI layer), exactly like lib/leveling.ts / lib/giveaways.ts.
// The bot mirrors the pieces it needs (normalisation, metric resolution,
// progress, message templating, stats) in pulse-bot/src/milestones.js — keep
// the two in sync the same way lib/leveling.ts ↔ leveling.js are.

// ── Metrics ───────────────────────────────────────────────────────────────────
// Every milestone tracks exactly one of these. join_age is derived from the
// Discord join date (bot-side); the rest come from the
// get_member_milestone_metrics RPC (messages/voice/commands/events/giveaways)
// or member_levels (xp/level).

export type MilestoneMetric =
  | 'join_age'
  | 'messages'
  | 'voice_minutes'
  | 'events'
  | 'giveaways'
  | 'xp'
  | 'level'

export const MILESTONE_METRICS: MilestoneMetric[] = [
  'join_age',
  'messages',
  'voice_minutes',
  'events',
  'giveaways',
  'xp',
  'level',
]

export type MetricMeta = {
  label: string
  /** Singular unit noun for the threshold input (e.g. "day", "message"). */
  unit: string
  /** lucide icon NAME (resolved in the UI). */
  icon: string
  /** One-liner shown in the editor. */
  hint: string
  /** Quick-fill threshold suggestions for the editor. */
  suggestions: number[]
}

export const METRIC_META: Record<MilestoneMetric, MetricMeta> = {
  join_age: {
    label: 'Time in server',
    unit: 'day',
    icon: 'CalendarClock',
    hint: 'Days since the member joined the server.',
    suggestions: [7, 30, 90, 180, 365],
  },
  messages: {
    label: 'Messages sent',
    unit: 'message',
    icon: 'MessageSquare',
    hint: 'Total messages the member has sent.',
    suggestions: [100, 500, 1000, 5000, 10000],
  },
  voice_minutes: {
    label: 'Voice activity',
    unit: 'minute',
    icon: 'Mic',
    hint: 'Total minutes the member has spent in voice channels.',
    suggestions: [60, 600, 1800, 6000],
  },
  events: {
    label: 'Event participation',
    unit: 'event',
    icon: 'CalendarDays',
    hint: 'Scheduled events the member has shown interest in.',
    suggestions: [1, 5, 10, 25],
  },
  giveaways: {
    label: 'Giveaway participation',
    unit: 'giveaway',
    icon: 'Gift',
    hint: 'Giveaways the member has entered.',
    suggestions: [1, 5, 10, 25],
  },
  xp: {
    label: 'Total XP',
    unit: 'XP',
    icon: 'Sparkles',
    hint: 'Cumulative XP the member has earned.',
    suggestions: [1000, 10000, 50000, 100000],
  },
  level: {
    label: 'Level reached',
    unit: 'level',
    icon: 'TrendingUp',
    hint: 'The level the member has reached.',
    suggestions: [5, 10, 25, 50, 100],
  },
}

export function isMilestoneMetric(v: unknown): v is MilestoneMetric {
  return typeof v === 'string' && (MILESTONE_METRICS as string[]).includes(v)
}

// ── Definition shape ────────────────────────────────────────────────────────

export type AnnounceMode = 'off' | 'channel' | 'dm'

export type MilestoneReward = { role_id: string }

export type Milestone = {
  id: string
  guild_id: string
  name: string
  description: string | null
  metric: MilestoneMetric
  threshold: number
  enabled: boolean
  icon: string
  rewards: MilestoneReward[]
  announce: AnnounceMode
  announce_channel_id: string | null
  message: string
  created_by: string | null
  created_at: string
  updated_at: string
}

/** The editable subset the create/edit form produces. */
export type MilestoneDraft = {
  name: string
  description: string
  metric: MilestoneMetric
  threshold: number
  enabled: boolean
  icon: string
  rewards: MilestoneReward[]
  announce: AnnounceMode
  announce_channel_id: string | null
  message: string
}

/** A member's current metric values — the input to milestone evaluation. */
export type MemberMetrics = {
  join_age_days: number
  messages: number
  voice_minutes: number
  events: number
  giveaways: number
  xp: number
  level: number
}

export const DEFAULT_MILESTONE_MESSAGE =
  'Congratulations {mention} — you reached the **{milestone}** milestone in {server}!'

export const MILESTONE_LIMITS = {
  maxName: 80,
  maxDescription: 300,
  maxMessage: 500,
  maxThreshold: 100_000_000,
  maxRewards: 10,
  maxMilestones: 100,
} as const

// ── Normalisation ─────────────────────────────────────────────────────────────

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function normaliseAnnounce(v: unknown): AnnounceMode {
  return v === 'off' || v === 'channel' || v === 'dm' ? v : 'channel'
}

export function normaliseRewards(raw: unknown): MilestoneReward[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: MilestoneReward[] = []
  for (const r of raw) {
    let roleId = ''
    if (typeof r === 'string') roleId = r
    else if (r && typeof r === 'object') roleId = String((r as Record<string, unknown>).role_id ?? '')
    if (!roleId || seen.has(roleId)) continue
    seen.add(roleId)
    out.push({ role_id: roleId })
  }
  return out.slice(0, MILESTONE_LIMITS.maxRewards)
}

type MilestoneRow = {
  id?: string
  guild_id?: string
  name?: string | null
  description?: string | null
  metric?: string | null
  threshold?: number | string | null
  enabled?: boolean | null
  icon?: string | null
  rewards?: unknown
  announce?: string | null
  announce_channel_id?: string | null
  message?: string | null
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
}

/** Coerce a raw milestones row into a fully-shaped, clamped Milestone. */
export function normaliseMilestone(row: MilestoneRow): Milestone {
  const metric = isMilestoneMetric(row.metric) ? row.metric : 'messages'
  const message =
    typeof row.message === 'string' && row.message.trim()
      ? row.message.slice(0, MILESTONE_LIMITS.maxMessage)
      : DEFAULT_MILESTONE_MESSAGE
  return {
    id: String(row.id ?? ''),
    guild_id: String(row.guild_id ?? ''),
    name: String(row.name ?? '').slice(0, MILESTONE_LIMITS.maxName) || 'Milestone',
    description: row.description ? String(row.description).slice(0, MILESTONE_LIMITS.maxDescription) : null,
    metric,
    threshold: clampNum(row.threshold, 1, MILESTONE_LIMITS.maxThreshold, 1),
    enabled: row.enabled !== false,
    icon: typeof row.icon === 'string' && row.icon ? row.icon : METRIC_META[metric].icon,
    rewards: normaliseRewards(row.rewards),
    announce: normaliseAnnounce(row.announce),
    announce_channel_id:
      typeof row.announce_channel_id === 'string' && row.announce_channel_id ? row.announce_channel_id : null,
    message,
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

/** Validate a draft; returns an error string or null. */
export function validateMilestoneDraft(draft: MilestoneDraft): string | null {
  if (!draft.name.trim()) return 'Give your milestone a name.'
  if (!isMilestoneMetric(draft.metric)) return 'Pick what the milestone tracks.'
  if (!Number.isFinite(draft.threshold) || draft.threshold < 1) return 'The threshold must be at least 1.'
  if (draft.threshold > MILESTONE_LIMITS.maxThreshold) return 'That threshold is too large.'
  if (draft.announce === 'channel' && !draft.announce_channel_id) {
    return 'Choose a channel to announce in, or set announcements to off / DM.'
  }
  return null
}

/** The persisted column shape for an insert/update (re-normalised draft). */
export function draftToRow(draft: MilestoneDraft): {
  name: string
  description: string | null
  metric: MilestoneMetric
  threshold: number
  enabled: boolean
  icon: string
  rewards: MilestoneReward[]
  announce: AnnounceMode
  announce_channel_id: string | null
  message: string
} {
  const metric = isMilestoneMetric(draft.metric) ? draft.metric : 'messages'
  return {
    name: draft.name.trim().slice(0, MILESTONE_LIMITS.maxName),
    description: draft.description.trim().slice(0, MILESTONE_LIMITS.maxDescription) || null,
    metric,
    threshold: clampNum(draft.threshold, 1, MILESTONE_LIMITS.maxThreshold, 1),
    enabled: draft.enabled !== false,
    icon: draft.icon || METRIC_META[metric].icon,
    rewards: normaliseRewards(draft.rewards),
    announce: normaliseAnnounce(draft.announce),
    announce_channel_id: draft.announce === 'channel' ? draft.announce_channel_id : null,
    message:
      draft.message.trim() ? draft.message.trim().slice(0, MILESTONE_LIMITS.maxMessage) : DEFAULT_MILESTONE_MESSAGE,
  }
}

// ── Metric resolution + progress ────────────────────────────────────────────

/** The comparable number for `metric` from a member's metrics. */
export function metricValue(metrics: MemberMetrics, metric: MilestoneMetric): number {
  switch (metric) {
    case 'join_age':
      return metrics.join_age_days
    case 'messages':
      return metrics.messages
    case 'voice_minutes':
      return metrics.voice_minutes
    case 'events':
      return metrics.events
    case 'giveaways':
      return metrics.giveaways
    case 'xp':
      return metrics.xp
    case 'level':
      return metrics.level
    default:
      return 0
  }
}

export function isMet(value: number, threshold: number): boolean {
  return value >= threshold
}

export type MilestoneProgress = {
  value: number
  threshold: number
  /** 0–100, rounded. */
  pct: number
  met: boolean
  /** How much more is needed (0 once met). */
  remaining: number
}

export function milestoneProgress(value: number, threshold: number): MilestoneProgress {
  const v = Math.max(0, value)
  const t = Math.max(1, threshold)
  return {
    value: v,
    threshold: t,
    pct: Math.max(0, Math.min(100, Math.round((v / t) * 100))),
    met: v >= t,
    remaining: Math.max(0, t - v),
  }
}

// ── Display formatting ──────────────────────────────────────────────────────

/** Human-format a metric value (e.g. minutes → "10h", days → "1y 2mo"). */
export function formatMetricValue(metric: MilestoneMetric, value: number): string {
  const n = Math.max(0, Math.round(value))
  if (metric === 'voice_minutes') {
    if (n < 60) return `${n}m`
    const h = Math.floor(n / 60)
    const m = n % 60
    return m ? `${h}h ${m}m` : `${h}h`
  }
  if (metric === 'join_age') {
    if (n < 30) return `${n}d`
    if (n < 365) {
      const mo = Math.floor(n / 30)
      return `${mo}mo`
    }
    const y = Math.floor(n / 365)
    const mo = Math.floor((n % 365) / 30)
    return mo ? `${y}y ${mo}mo` : `${y}y`
  }
  if (metric === 'level') return `Lvl ${n.toLocaleString()}`
  return n.toLocaleString()
}

/**
 * Long, fully-spelled value for a metric — "7 days", "3 months", "10 hours",
 * "1,000 messages" — used in the dashboard editor + member achievements where
 * abbreviations like "7d"/"3mo" read poorly. (formatMetricValue stays the
 * compact form for tight chips.)
 */
export function formatMetricValueLong(metric: MilestoneMetric, value: number): string {
  const n = Math.max(0, Math.round(value))
  const plural = (count: number, unit: string) => `${count.toLocaleString()} ${unit}${count === 1 ? '' : 's'}`
  if (metric === 'voice_minutes') {
    if (n < 60) return plural(n, 'minute')
    const h = Math.floor(n / 60)
    const m = n % 60
    return m ? `${plural(h, 'hour')} ${plural(m, 'minute')}` : plural(h, 'hour')
  }
  if (metric === 'join_age') {
    if (n < 30) return plural(n, 'day')
    if (n < 365) return plural(Math.floor(n / 30), 'month')
    const y = Math.floor(n / 365)
    const mo = Math.floor((n % 365) / 30)
    return mo ? `${plural(y, 'year')} ${plural(mo, 'month')}` : plural(y, 'year')
  }
  if (metric === 'level') return `Level ${n.toLocaleString()}`
  if (metric === 'xp') return `${n.toLocaleString()} XP`
  return plural(n, METRIC_META[metric].unit)
}

/** Long trigger label, e.g. "1,000 messages", "7 days in server", "Level 25". */
export function describeThresholdLong(metric: MilestoneMetric, threshold: number): string {
  const n = Math.max(1, Math.round(threshold))
  if (metric === 'join_age') return `${formatMetricValueLong('join_age', n)} in server`
  if (metric === 'voice_minutes') return `${formatMetricValueLong('voice_minutes', n)} in voice`
  return formatMetricValueLong(metric, n)
}

/** A short label for the milestone's trigger, e.g. "1,000 messages". */
export function describeThreshold(metric: MilestoneMetric, threshold: number): string {
  const meta = METRIC_META[metric]
  const n = Math.max(1, Math.round(threshold))
  if (metric === 'join_age') return `${formatMetricValue('join_age', n)} in server`
  if (metric === 'voice_minutes') return `${formatMetricValue('voice_minutes', n)} in voice`
  if (metric === 'level') return `Level ${n.toLocaleString()}`
  if (metric === 'xp') return `${n.toLocaleString()} XP`
  const unit = n === 1 ? meta.unit : `${meta.unit}s`
  return `${n.toLocaleString()} ${unit}`
}

// ── Message templating ────────────────────────────────────────────────────────

export type MilestoneContext = {
  user: string
  mention: string
  milestone: string
  server: string
  value: number | string
}

export function renderMilestoneMessage(template: string, ctx: MilestoneContext): string {
  return String(template ?? '')
    .replace(/\{user\}/g, ctx.user)
    .replace(/\{mention\}/g, ctx.mention)
    .replace(/\{milestone\}/g, ctx.milestone)
    .replace(/\{server\}/g, ctx.server)
    .replace(/\{value\}/g, String(ctx.value))
}

// ── Built-in presets (editor quick-fill) ──────────────────────────────────────

export type MilestonePreset = {
  name: string
  description: string
  metric: MilestoneMetric
  threshold: number
  icon: string
}

export const MILESTONE_PRESETS: MilestonePreset[] = [
  { name: '1 Year Member', description: 'A full year in the community.', metric: 'join_age', threshold: 365, icon: 'Crown' },
  { name: '90 Day Member', description: 'Three months and going strong.', metric: 'join_age', threshold: 90, icon: 'CalendarClock' },
  { name: '1,000 Messages', description: 'A thousand messages sent.', metric: 'messages', threshold: 1000, icon: 'MessageSquare' },
  { name: 'Voice Veteran', description: '10 hours in voice channels.', metric: 'voice_minutes', threshold: 600, icon: 'Mic' },
  { name: 'Giveaway Regular', description: 'Entered 10 giveaways.', metric: 'giveaways', threshold: 10, icon: 'Gift' },
  { name: 'Event Goer', description: 'Joined 5 events.', metric: 'events', threshold: 5, icon: 'CalendarDays' },
  { name: 'Level 25', description: 'Reached level 25.', metric: 'level', threshold: 25, icon: 'TrendingUp' },
]

// ── Analytics ─────────────────────────────────────────────────────────────────

export type MilestoneCompletion = {
  milestone_id: string
  user_id: string
  user_name: string | null
  value: number
  completed_at: string
}

export type MilestoneStats = {
  total: number
  active: number
  totalEarned: number
  /** Distinct members who have earned at least one milestone. */
  membersRecognised: number
  /** Per-milestone earned counts, sorted desc. */
  byMilestone: { id: string; name: string; metric: MilestoneMetric; earned: number }[]
  /** The single most-earned milestone, or null. */
  mostEarned: { id: string; name: string; earned: number } | null
  /** Completions per day for the last 14 days (for the chart). */
  series: { date: string; count: number }[]
}

/** Compute milestone analytics in JS from loaded rows (no extra RPC). */
export function computeMilestoneStats(
  milestones: Milestone[],
  completions: MilestoneCompletion[],
): MilestoneStats {
  const counts = new Map<string, number>()
  const members = new Set<string>()
  for (const c of completions) {
    counts.set(c.milestone_id, (counts.get(c.milestone_id) ?? 0) + 1)
    members.add(c.user_id)
  }

  const byMilestone = milestones
    .map((m) => ({ id: m.id, name: m.name, metric: m.metric, earned: counts.get(m.id) ?? 0 }))
    .sort((a, b) => b.earned - a.earned)

  const mostEarned =
    byMilestone.length > 0 && byMilestone[0].earned > 0
      ? { id: byMilestone[0].id, name: byMilestone[0].name, earned: byMilestone[0].earned }
      : null

  // 14-day completions series (UTC days).
  const days = 14
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const series: { date: string; count: number }[] = []
  const dayCounts = new Map<string, number>()
  for (const c of completions) {
    const d = new Date(c.completed_at)
    if (Number.isNaN(d.getTime())) continue
    const key = d.toISOString().slice(0, 10)
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1)
  }
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    series.push({ date: key, count: dayCounts.get(key) ?? 0 })
  }

  return {
    total: milestones.length,
    active: milestones.filter((m) => m.enabled).length,
    totalEarned: completions.length,
    membersRecognised: members.size,
    byMilestone,
    mostEarned,
    series,
  }
}

/** Build a MemberMetrics from the get_member_milestone_metrics RPC row + join age. */
export function metricsFromRow(
  row: { messages?: number; voice_seconds?: number; events?: number; giveaways?: number; xp?: number; level?: number } | null | undefined,
  joinAgeDays: number,
): MemberMetrics {
  return {
    join_age_days: Math.max(0, Math.floor(joinAgeDays)),
    messages: Number(row?.messages ?? 0),
    voice_minutes: Math.floor(Number(row?.voice_seconds ?? 0) / 60),
    events: Number(row?.events ?? 0),
    giveaways: Number(row?.giveaways ?? 0),
    xp: Number(row?.xp ?? 0),
    level: Number(row?.level ?? 0),
  }
}
