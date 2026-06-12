// Reputation / trust scoring for Discord members.
//
// A member's reputation is a 0-100 score derived from how long they've been
// around (account age + server tenure), how much they participate (messages,
// voice, commands, channels, roles) and their moderation history (warnings,
// timeouts, kicks, bans act as penalties). The score is deterministic and
// computed on the fly from the same inputs the directory and profile already
// load — there is no separate stored "score" to drift out of sync.
//
// Risk level is a *separate* read of the moderation history alone, used by the
// moderation-insights views to surface members who need attention regardless of
// how active or established they otherwise are.

export type ReputationInput = {
  /** Days since the Discord account was created (from the user snowflake). */
  accountAgeDays: number
  /** Days since the member joined this server. */
  tenureDays: number
  /** Messages sent (lifetime, or within the active window). */
  messages: number
  /** Total seconds spent in voice channels. */
  voiceSeconds: number
  /** Slash/bot commands used. */
  commands: number
  /** Distinct channels the member has posted in. */
  activeChannels: number
  /** Count of assignable (non-managed, non-@everyone) roles held. */
  assignableRoles: number
  /** Active warnings. */
  warnings: number
  /** Recorded timeouts. */
  timeouts: number
  /** Recorded kicks. */
  kicks: number
  /** Recorded bans. */
  bans: number
}

export type ReputationTier =
  | 'trusted'
  | 'established'
  | 'active'
  | 'newcomer'
  | 'at_risk'

export type Reputation = {
  /** 0-100, clamped. */
  score: number
  tier: ReputationTier
  label: string
  /** Hex / CSS colour for the badge accent. */
  color: string
  /** Component contributions, for the "how this was calculated" breakdown. */
  breakdown: { label: string; points: number }[]
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(1, n))
}

// Diminishing-returns curve: maps a raw count to 0..1, hitting ~1 at `full`.
function logScale(value: number, full: number): number {
  if (value <= 0) return 0
  return clamp01(Math.log10(value + 1) / Math.log10(full + 1))
}

const TIER_META: Record<ReputationTier, { label: string; color: string }> = {
  trusted: { label: 'Trusted', color: 'var(--green)' },
  established: { label: 'Established', color: 'var(--cyan)' },
  active: { label: 'Active', color: 'var(--p-1)' },
  newcomer: { label: 'Newcomer', color: 'var(--amber)' },
  at_risk: { label: 'At risk', color: 'var(--red)' },
}

function tierForScore(score: number): ReputationTier {
  if (score >= 80) return 'trusted'
  if (score >= 60) return 'established'
  if (score >= 40) return 'active'
  if (score >= 20) return 'newcomer'
  return 'at_risk'
}

/**
 * Build a display-only Reputation from a precomputed score — for surfaces (like
 * the leaderboard) that already have the global score but not the full input,
 * so they can render the same `<ReputationBadge>` as the members table.
 */
export function reputationFromScore(score: number): Reputation {
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const tier = tierForScore(clamped)
  return {
    score: clamped,
    tier,
    label: TIER_META[tier].label,
    color: TIER_META[tier].color,
    breakdown: [],
  }
}

/**
 * Compute a member's reputation. Positive components sum to ~85 on top of a
 * 15-point baseline (so an established lurker isn't a zero); infractions
 * subtract. The result is clamped to 0-100.
 */
export function computeReputation(input: ReputationInput): Reputation {
  const baseline = 15
  const age = clamp01(input.accountAgeDays / 365) * 15
  const tenure = clamp01(input.tenureDays / 180) * 15
  const messages = logScale(input.messages, 1000) * 30
  const voice = clamp01(input.voiceSeconds / (50 * 3600)) * 10
  const engagement =
    clamp01(input.activeChannels / 10) * 5 + logScale(input.commands, 50) * 5
  const roles = clamp01(input.assignableRoles / 3) * 5

  const penalty =
    input.warnings * 8 + input.timeouts * 6 + input.kicks * 15 + input.bans * 40

  const raw =
    baseline + age + tenure + messages + voice + engagement + roles - penalty
  const score = Math.max(0, Math.min(100, Math.round(raw)))
  const tier = tierForScore(score)

  return {
    score,
    tier,
    label: TIER_META[tier].label,
    color: TIER_META[tier].color,
    breakdown: [
      { label: 'Baseline', points: baseline },
      { label: 'Account age', points: Math.round(age) },
      { label: 'Server tenure', points: Math.round(tenure) },
      { label: 'Messages', points: Math.round(messages) },
      { label: 'Voice activity', points: Math.round(voice) },
      { label: 'Engagement', points: Math.round(engagement) },
      { label: 'Roles', points: Math.round(roles) },
      { label: 'Moderation history', points: -Math.round(penalty) },
    ],
  }
}

export type RiskLevel = 'none' | 'low' | 'medium' | 'high'

export type RiskInput = {
  warnings: number
  timeouts: number
  kicks: number
  bans: number
  /** ISO timestamp of the most recent infraction, if any. */
  lastInfractionAt: string | null
}

export type RiskAssessment = {
  level: RiskLevel
  label: string
  color: string
  /** True when the member has a pattern of repeated infractions. */
  repeatOffender: boolean
  /** Human-readable reasons backing the assessment. */
  reasons: string[]
}

const RISK_META: Record<RiskLevel, { label: string; color: string }> = {
  none: { label: 'Clear', color: 'var(--green)' },
  low: { label: 'Low risk', color: 'var(--cyan)' },
  medium: { label: 'Medium risk', color: 'var(--amber)' },
  high: { label: 'High risk', color: 'var(--red)' },
}

const THIRTY_DAYS_MS = 30 * 86_400_000

/**
 * Assess moderation risk from infraction history alone. Bans/kicks or a
 * cluster of warnings push a member to "high"; a single recent warning or
 * timeout is "medium"; older lone infractions are "low".
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  const total = input.warnings + input.timeouts + input.kicks + input.bans
  const reasons: string[] = []

  if (input.bans > 0) reasons.push(`${input.bans} ban${input.bans > 1 ? 's' : ''} on record`)
  if (input.kicks > 0) reasons.push(`${input.kicks} kick${input.kicks > 1 ? 's' : ''}`)
  if (input.warnings > 0) reasons.push(`${input.warnings} warning${input.warnings > 1 ? 's' : ''}`)
  if (input.timeouts > 0) reasons.push(`${input.timeouts} timeout${input.timeouts > 1 ? 's' : ''}`)

  const recent =
    input.lastInfractionAt != null &&
    Date.now() - new Date(input.lastInfractionAt).getTime() < THIRTY_DAYS_MS

  // A repeat offender has 3+ total infractions or distinct repeated types.
  const distinctTypes = [input.warnings, input.timeouts, input.kicks, input.bans].filter(
    (n) => n > 0,
  ).length
  const repeatOffender = total >= 3 || distinctTypes >= 2 || input.warnings >= 3

  let level: RiskLevel
  if (input.bans > 0 || input.kicks > 0 || input.warnings >= 3 || (repeatOffender && recent)) {
    level = 'high'
  } else if ((input.warnings >= 1 || input.timeouts >= 1) && recent) {
    level = 'medium'
  } else if (total > 0) {
    level = 'low'
  } else {
    level = 'none'
  }

  if (repeatOffender) reasons.push('Repeat offender')
  if (recent && level !== 'none') reasons.push('Recent activity (last 30 days)')

  return {
    level,
    label: RISK_META[level].label,
    color: RISK_META[level].color,
    repeatOffender,
    reasons,
  }
}

/** Days between a past ISO timestamp and now (floored, never negative). */
export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000)
}
