// Alt Risk Detection — pure model + scoring engine (PULSIFY-59).
//
// Two things live here, and NEITHER of them claims certainty:
//
//   1. computeAltRisk() — turns the signals Pulse already collects about an
//      account (age, join recency, avatar, activity, moderation, reputation,
//      economy, giveaways, applications, onboarding/verification, prior safety
//      flags) into a 0-100 Alt Risk Score and a band: Low / Moderate / High /
//      Critical. It is deterministic and explainable — every point that lands on
//      the score comes back as a labelled signal, so a moderator can see exactly
//      why an account scored what it scored.
//
//   2. correlateAccounts() — scores how likely two accounts are related, from
//      username similarity, join/creation proximity, shared moderation history,
//      shared economy transfers and activity-pattern overlap. The result is a
//      confidence PERCENTAGE, never a verdict: the UI calls these "Potential
//      linked accounts" and caps automatic confidence below 100 on purpose.
//      Only a moderator-asserted link (alt_account_links) reaches 100.
//
// Discord exposes no IP, no device, no email — so no scoring model can prove an
// alt. This one is built to be *useful evidence for a human*, which is why the
// weights below are deliberately conservative: a legitimate new member should
// land in Moderate, not Critical. Anything that fires on a brand-new account is
// suppressed until they've had a fair chance to use it (see TENURE_GRACE_*).
//
// No JSX / framework / IO imports — safe to import into client components. The
// bot mirrors this file in pulse-bot/src/alt-detection.js; keep the two in sync
// the same way lib/birthdays.ts ↔ birthdays.js are.

// ── Risk levels ───────────────────────────────────────────────────────────────

export type AltRiskLevel = 'low' | 'moderate' | 'high' | 'critical'

export const RISK_LEVELS: AltRiskLevel[] = ['low', 'moderate', 'high', 'critical']

export const RISK_META: Record<
  AltRiskLevel,
  { label: string; color: string; /** Tailwind-free rgba tint for badges. */ tint: string; blurb: string }
> = {
  low: {
    label: 'Low',
    color: '#34d399',
    tint: 'rgba(52,211,153,0.14)',
    blurb: 'Looks like an established account.',
  },
  moderate: {
    label: 'Moderate',
    color: '#fbbf24',
    tint: 'rgba(251,191,36,0.14)',
    blurb: 'A few alt indicators — nothing conclusive.',
  },
  high: {
    label: 'High',
    color: '#fb923c',
    tint: 'rgba(251,146,60,0.14)',
    blurb: 'Several indicators line up. Worth a review.',
  },
  critical: {
    label: 'Critical',
    color: '#f87171',
    tint: 'rgba(248,113,113,0.14)',
    blurb: 'Matches the profile of a throwaway or evasion alt.',
  },
}

/** Lower bound of each band, in score points. */
export const RISK_THRESHOLDS: Record<AltRiskLevel, number> = {
  low: 0,
  moderate: 25,
  high: 50,
  critical: 75,
}

export function riskLevelForScore(score: number): AltRiskLevel {
  if (score >= RISK_THRESHOLDS.critical) return 'critical'
  if (score >= RISK_THRESHOLDS.high) return 'high'
  if (score >= RISK_THRESHOLDS.moderate) return 'moderate'
  return 'low'
}

/** True for the bands a moderator is expected to act on (drives the queue + auto-flagging). */
export function isActionable(level: AltRiskLevel): boolean {
  return level === 'high' || level === 'critical'
}

// ── Signals ───────────────────────────────────────────────────────────────────

/** A signal either adds risk or subtracts it (evidence the account is genuine). */
export type SignalTone = 'risk' | 'mitigating'

export type AltSignalId =
  | 'new_account'
  | 'established_account'
  | 'recent_join'
  | 'fresh_account_fresh_join'
  | 'default_avatar'
  | 'no_activity'
  | 'low_activity'
  | 'established_activity'
  | 'moderation_history'
  | 'low_reputation'
  | 'trusted_reputation'
  | 'no_economy'
  | 'economy_activity'
  | 'giveaway_farming'
  | 'application_history'
  | 'onboarding_incomplete'
  | 'onboarding_complete'
  | 'unverified'
  | 'verified'
  | 'guard_flags'
  | 'security_flags'
  | 'prior_alt'
  | 'linked_accounts'

export type AltSignal = {
  id: AltSignalId
  label: string
  /** One line a moderator can read without knowing the model. */
  detail: string
  /** Signed contribution to the score (positive = risk, negative = mitigating). */
  points: number
  tone: SignalTone
}

/**
 * Signals that fire on account age / join recency would flag EVERY new member,
 * so the ones that need time to be fair (activity, onboarding, verification)
 * stay silent until the member has actually had a chance to do the thing.
 */
const TENURE_GRACE_ACTIVITY_DAYS = 2
const TENURE_GRACE_ONBOARDING_DAYS = 1

/** Lifetime coins (earned + spent) above which an account has a real stake. */
const ECONOMY_ESTABLISHED_COINS = 250

export type AltRiskInput = {
  /** ISO account-creation timestamp (from the Discord snowflake). */
  accountCreatedAt: string | null
  /** ISO server-join timestamp. Null when the user is not a member. */
  joinedAt: string | null
  /** False when the account still uses a Discord default avatar. */
  hasAvatar: boolean
  /** Guild activity totals. */
  messages: number
  voiceSeconds: number
  /** Moderation history in this guild. */
  warnings: number
  timeouts: number
  kicks: number
  bans: number
  /** Global 0-100 Pulse reputation. */
  reputation: number
  /** Global Pulse Coin balance, and lifetime coins earned + spent (the "footprint"). */
  coinBalance: number
  economyLifetime: number
  /** Giveaways entered in this guild. */
  giveawayEntries: number
  /** Applications submitted (ticket_applications). */
  applications: number
  /** Whether this guild runs the onboarding module at all — when it doesn't,
   *  the onboarding + verification signals are skipped entirely rather than
   *  penalising every member of a server that never turned it on. */
  onboardingEnabled: boolean
  onboardingCompleted: boolean
  onboardingVerified: boolean
  /** Pulse Guard hits (ai_moderation_events) against this account. */
  guardFlags: number
  /** DDoS/abuse detections (security_events) naming this account as the actor. */
  securityFlags: number
  /** A previous investigation in this guild concluded "confirmed alt". */
  priorConfirmedAlt: boolean
  /** Moderator-asserted links to other accounts. */
  manualLinks: number
  /** Reference clock — injectable so tests and the bot agree. */
  now?: Date
}

export type AltRiskAssessment = {
  /** 0-100. */
  score: number
  level: AltRiskLevel
  label: string
  color: string
  /** Every signal that fired, risk first, ordered by weight. */
  signals: AltSignal[]
  /** Sum of the positive contributions (before mitigations). */
  riskPoints: number
  /** Sum of the negative contributions, as a positive number. */
  mitigatingPoints: number
  /** What a moderator should do next, in one sentence. */
  recommendation: string
}

const RECOMMENDATION: Record<AltRiskLevel, string> = {
  low: 'No action needed — this account reads as an established member.',
  moderate: 'Nothing conclusive. Keep the account under normal moderation and revisit if behaviour changes.',
  high: 'Worth a review. Several alt indicators line up — check the potential linked accounts before acting.',
  critical: 'Investigate. This account matches the profile of a throwaway or ban-evasion alt; confirm against the linked accounts.',
}

/** Whole days between an ISO timestamp and `now` (0 when missing/in the future). */
export function daysBetween(iso: string | null | undefined, now: Date): number {
  if (!iso) return 0
  const ms = now.getTime() - new Date(iso).getTime()
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000)
}

/** Hours between an ISO timestamp and `now` (0 when missing/in the future). */
function hoursBetween(iso: string | null | undefined, now: Date): number {
  if (!iso) return 0
  const ms = now.getTime() - new Date(iso).getTime()
  return ms <= 0 ? 0 : ms / 3_600_000
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/**
 * Score an account against every available alt indicator.
 *
 * The score is the clamped sum of the signals below. Weights are tuned so that
 * a *legitimate* newcomer (young account, no history yet, but a real avatar)
 * lands in Moderate — the band that means "nothing to do" — while an account
 * that stacks throwaway traits (no avatar, no investment anywhere, prior flags,
 * an existing link to a known alt) climbs into High/Critical.
 */
export function computeAltRisk(input: AltRiskInput): AltRiskAssessment {
  const now = input.now ?? new Date()
  const signals: AltSignal[] = []
  const add = (id: AltSignalId, label: string, detail: string, points: number) => {
    signals.push({ id, label, detail, points, tone: points >= 0 ? 'risk' : 'mitigating' })
  }

  const accountAgeDays = daysBetween(input.accountCreatedAt, now)
  const knownAge = input.accountCreatedAt != null
  const tenureDays = daysBetween(input.joinedAt, now)
  const joinHours = hoursBetween(input.joinedAt, now)
  const isMember = input.joinedAt != null

  // ── Account age ──
  // The single strongest ordinary indicator: alts are made, used and discarded.
  if (knownAge) {
    if (accountAgeDays < 2) {
      add('new_account', 'Brand-new account', `Created ${accountAgeDays === 0 ? 'today' : 'yesterday'}.`, 22)
    } else if (accountAgeDays < 7) {
      add('new_account', 'Very new account', `Created ${accountAgeDays} days ago.`, 16)
    } else if (accountAgeDays < 30) {
      add('new_account', 'New account', `Created ${accountAgeDays} days ago.`, 10)
    } else if (accountAgeDays < 90) {
      add('new_account', 'Young account', `Created ${accountAgeDays} days ago.`, 5)
    } else if (accountAgeDays >= 365) {
      const years = Math.floor(accountAgeDays / 365)
      add('established_account', 'Established account', `Over ${years} year${years > 1 ? 's' : ''} old.`, -8)
    }
  }

  // ── Join recency ──
  if (isMember) {
    if (joinHours < 24) {
      add('recent_join', 'Joined today', 'Joined the server within the last 24 hours.', 5)
    } else if (tenureDays < 7) {
      add('recent_join', 'Recent join', `Joined ${tenureDays} day${tenureDays === 1 ? '' : 's'} ago.`, 3)
    }
    // The combination is what matters: an account made shortly before it walked
    // in is a far stronger tell than either fact on its own.
    if (knownAge && accountAgeDays < 30 && joinHours < 48) {
      add(
        'fresh_account_fresh_join',
        'Created shortly before joining',
        'The account was made days before it joined this server.',
        6,
      )
    }
  }

  // ── Profile investment ──
  if (!input.hasAvatar) {
    add('default_avatar', 'Default avatar', 'Still using a Discord default avatar.', 8)
  }

  // ── Activity ──
  // Suppressed for the first couple of days — a member who just walked in hasn't
  // had a chance to speak, and flagging them for it would flag everyone.
  const totalActivity = input.messages + Math.floor(input.voiceSeconds / 60)
  if (!isMember || tenureDays >= TENURE_GRACE_ACTIVITY_DAYS) {
    if (totalActivity === 0) {
      add('no_activity', 'No activity', 'Has never sent a message or joined voice here.', 10)
    } else if (input.messages < 10) {
      add('low_activity', 'Barely active', `Only ${input.messages} message${input.messages === 1 ? '' : 's'} sent.`, 5)
    }
  }
  if (input.messages >= 250) {
    add('established_activity', 'Long activity history', `${input.messages.toLocaleString()} messages sent here.`, -10)
  } else if (input.messages >= 50) {
    add('established_activity', 'Active member', `${input.messages} messages sent here.`, -6)
  }

  // ── Moderation history ──
  const infractions = input.warnings + input.timeouts
  if (input.bans > 0 || input.kicks > 0) {
    const parts: string[] = []
    if (input.bans > 0) parts.push(`${input.bans} ban${input.bans > 1 ? 's' : ''}`)
    if (input.kicks > 0) parts.push(`${input.kicks} kick${input.kicks > 1 ? 's' : ''}`)
    add('moderation_history', 'Removed before', `${parts.join(' and ')} on record in this server.`, 20)
  } else if (infractions >= 3) {
    add('moderation_history', 'Repeat infractions', `${infractions} warnings/timeouts on record.`, 12)
  } else if (infractions >= 1) {
    add('moderation_history', 'Moderation history', `${infractions} warning${infractions > 1 ? 's' : ''}/timeout${infractions > 1 ? 's' : ''} on record.`, 6)
  }

  // ── Reputation (global trust score) ──
  if (input.reputation >= 70) {
    add('trusted_reputation', 'Trusted across Pulse', `Global reputation of ${input.reputation}.`, -10)
  } else if (input.reputation < 20) {
    add('low_reputation', 'Low reputation', `Global reputation of ${input.reputation}.`, 6)
  } else if (input.reputation < 40) {
    add('low_reputation', 'Below-average reputation', `Global reputation of ${input.reputation}.`, 3)
  }

  // ── Economy ──
  // The economy is global, so a throwaway shows up here as an account with no
  // stake anywhere on the network — not just no stake in this server.
  if (input.coinBalance === 0 && input.economyLifetime === 0) {
    add('no_economy', 'No economy footprint', 'No Pulse Coins ever earned or spent, on any server.', 4)
  } else if (input.economyLifetime >= ECONOMY_ESTABLISHED_COINS) {
    add(
      'economy_activity',
      'Economy footprint',
      `${input.economyLifetime.toLocaleString()} coins earned and spent across Pulse.`,
      -5,
    )
  }

  // ── Giveaway farming ──
  // Entering draws without ever talking is the classic multi-account pattern.
  if (input.giveawayEntries > 0 && input.messages < 5 && (!isMember || tenureDays >= 1)) {
    add(
      'giveaway_farming',
      'Enters giveaways, never talks',
      `${input.giveawayEntries} giveaway ${input.giveawayEntries === 1 ? 'entry' : 'entries'} with almost no messages.`,
      8,
    )
  }

  // ── Applications ──
  if (input.applications > 0) {
    add('application_history', 'Applied to the server', `${input.applications} application${input.applications > 1 ? 's' : ''} submitted.`, -4)
  }

  // ── Onboarding & verification ──
  // Only when the guild actually runs onboarding, and only after a day.
  if (input.onboardingEnabled && (!isMember || tenureDays >= TENURE_GRACE_ONBOARDING_DAYS)) {
    if (input.onboardingCompleted) {
      add('onboarding_complete', 'Completed onboarding', 'Went through the server onboarding.', -4)
    } else {
      add('onboarding_incomplete', 'Skipped onboarding', 'Never completed the server onboarding.', 6)
    }
    if (input.onboardingVerified) {
      add('verified', 'Verified member', 'Passed the server verification step.', -5)
    } else {
      add('unverified', 'Not verified', 'Has not passed the server verification step.', 5)
    }
  }

  // ── Prior safety flags ──
  if (input.guardFlags > 0) {
    const points = clamp(6 + 3 * (input.guardFlags - 1), 6, 14)
    add('guard_flags', 'Pulse Guard flags', `${input.guardFlags} message${input.guardFlags > 1 ? 's' : ''} flagged by Pulse Guard.`, points)
  }
  if (input.securityFlags > 0) {
    add('security_flags', 'Security detections', `Named in ${input.securityFlags} abuse detection${input.securityFlags > 1 ? 's' : ''}.`, 10)
  }
  if (input.priorConfirmedAlt) {
    add('prior_alt', 'Previously confirmed as an alt', 'A closed investigation in this server confirmed this account.', 30)
  }
  if (input.manualLinks > 0) {
    add('linked_accounts', 'Linked by a moderator', `Manually linked to ${input.manualLinks} other account${input.manualLinks > 1 ? 's' : ''}.`, 12)
  }

  const riskPoints = signals.filter((s) => s.points > 0).reduce((sum, s) => sum + s.points, 0)
  const mitigatingPoints = signals.filter((s) => s.points < 0).reduce((sum, s) => sum - s.points, 0)
  const score = clamp(Math.round(riskPoints - mitigatingPoints), 0, 100)
  const level = riskLevelForScore(score)

  // Heaviest evidence first, mitigations last — the order a moderator reads in.
  signals.sort((a, b) => b.points - a.points)

  return {
    score,
    level,
    label: RISK_META[level].label,
    color: RISK_META[level].color,
    signals,
    riskPoints,
    mitigatingPoints,
    recommendation: RECOMMENDATION[level],
  }
}

// ── Name similarity ───────────────────────────────────────────────────────────

/** Lowercase, strip anything that isn't a letter or digit ("Luka_R!" → "lukar"). */
export function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** The name with its trailing digits removed ("luka2024" → "luka"). */
function nameStem(name: string): string {
  return normaliseName(name).replace(/\d+$/, '')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = curr
  }
  return prev[b.length]
}

/** 0-1 similarity between two usernames, ignoring case and punctuation. */
export function nameSimilarity(a: string, b: string): number {
  const x = normaliseName(a)
  const y = normaliseName(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const distance = levenshtein(x, y)
  return clamp(1 - distance / Math.max(x.length, y.length), 0, 1)
}

/**
 * True when two names share a stem and differ only by trailing digits —
 * "raguz" / "raguz2", "nova" / "nova99". The most common alt-naming habit there
 * is, and one plain edit distance under-weights on short names.
 */
export function sharesNameStem(a: string, b: string): boolean {
  const sa = nameStem(a)
  const sb = nameStem(b)
  if (sa.length < 3 || sb.length < 3) return false
  if (sa !== sb) return false
  // Identical after stripping digits, but not identical before → one is numbered.
  return normaliseName(a) !== normaliseName(b)
}

// ── Correlation (potential linked accounts) ───────────────────────────────────

export type LinkIndicatorId =
  | 'username'
  | 'join_time'
  | 'account_age'
  | 'moderation'
  | 'economy'
  | 'activity_pattern'
  | 'manual'

export type LinkIndicator = {
  id: LinkIndicatorId
  label: string
  detail: string
  /** 0-1 strength — combined with the others as a noisy-OR (see below). */
  weight: number
}

/** One account being compared against the subject. */
export type CorrelationCandidate = {
  userId: string
  /** Discord @handle. */
  username: string
  /** Display name / nickname, when different. */
  displayName: string | null
  /** Resolved avatar CDN URL, so the UI can render the row without a second fetch. */
  avatar: string
  accountCreatedAt: string | null
  joinedAt: string | null
  /** 24-slot message histogram (index = hour of day, UTC). Empty = unknown. */
  hourly: number[]
  /** Total messages — the histogram is only meaningful with enough volume. */
  messages: number
  /** The account's own risk assessment, so the UI can badge each candidate. */
  risk: { score: number; level: AltRiskLevel }
  /** Moderation overlap with the subject, precomputed by the caller. */
  sharedModeration: { moderator: string | null; reason: string | null; namesSubject: boolean } | null
  /** Coin transfers between this account and the subject. */
  sharedEconomy: number
  /** An existing moderator-asserted link (alt_account_links). */
  manualLink: { confidence: number; note: string | null } | null
}

/** The account being looked up. Its own avatar/risk play no part in correlation. */
export type CorrelationSubject = Omit<
  CorrelationCandidate,
  'risk' | 'sharedModeration' | 'sharedEconomy' | 'manualLink' | 'avatar'
>

export type LinkedAccount = {
  userId: string
  username: string
  displayName: string | null
  avatar: string
  /** 0-100. Automatic links are capped below 100 — only a moderator asserts 100. */
  confidence: number
  indicators: LinkIndicator[]
  risk: { score: number; level: AltRiskLevel }
  /** True when a moderator explicitly linked these two accounts. */
  manual: boolean
  note: string | null
}

/** Below this, a "link" is just noise — two members who happen to share a vowel. */
export const MIN_LINK_CONFIDENCE = 35

/** Automatic correlation never claims certainty, no matter how much lines up. */
export const MAX_AUTO_CONFIDENCE = 95

/** Cosine similarity of two 24-hour histograms (0 when either is empty). */
export function hourlySimilarity(a: number[], b: number[]): number {
  if (a.length !== 24 || b.length !== 24) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < 24; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Whole minutes between two ISO timestamps (Infinity when either is missing). */
function minutesApart(a: string | null, b: string | null): number {
  if (!a || !b) return Infinity
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60_000
}

/**
 * Score one candidate against the subject. Returns null when the evidence is too
 * thin to show — a single weak coincidence is not a link.
 */
export function correlateAccount(
  subject: CorrelationSubject,
  candidate: CorrelationCandidate,
): LinkedAccount | null {
  if (candidate.userId === subject.userId) return null

  // A moderator already linked these two — that outranks every computed signal.
  if (candidate.manualLink) {
    return {
      userId: candidate.userId,
      username: candidate.username,
      displayName: candidate.displayName,
      avatar: candidate.avatar,
      confidence: clamp(Math.round(candidate.manualLink.confidence), 0, 100),
      indicators: [
        {
          id: 'manual',
          label: 'Linked by a moderator',
          detail: candidate.manualLink.note?.trim() || 'A moderator marked these accounts as related.',
          weight: 1,
        },
      ],
      risk: candidate.risk,
      manual: true,
      note: candidate.manualLink.note,
    }
  }

  const indicators: LinkIndicator[] = []

  // ── Similar usernames ──
  const similarity = nameSimilarity(subject.username, candidate.username)
  if (sharesNameStem(subject.username, candidate.username)) {
    indicators.push({
      id: 'username',
      label: 'Numbered variant of the same name',
      detail: `"${candidate.username}" is the same name with different trailing digits.`,
      weight: 0.5,
    })
  } else if (similarity >= 0.85) {
    indicators.push({
      id: 'username',
      label: 'Near-identical username',
      detail: `"${candidate.username}" is ${Math.round(similarity * 100)}% similar.`,
      weight: 0.55,
    })
  } else if (similarity >= 0.72) {
    indicators.push({
      id: 'username',
      label: 'Similar username',
      detail: `"${candidate.username}" is ${Math.round(similarity * 100)}% similar.`,
      weight: 0.35,
    })
  }

  // ── Similar join times ──
  const joinGap = minutesApart(subject.joinedAt, candidate.joinedAt)
  if (joinGap <= 5) {
    indicators.push({
      id: 'join_time',
      label: 'Joined at the same moment',
      detail: `Both accounts joined within ${Math.max(1, Math.round(joinGap))} minute${joinGap < 1.5 ? '' : 's'} of each other.`,
      weight: 0.45,
    })
  } else if (joinGap <= 60) {
    indicators.push({
      id: 'join_time',
      label: 'Joined around the same time',
      detail: `Both accounts joined within ${Math.round(joinGap)} minutes of each other.`,
      weight: 0.3,
    })
  } else if (joinGap <= 1440) {
    indicators.push({
      id: 'join_time',
      label: 'Joined the same day',
      detail: `Joined ${Math.round(joinGap / 60)} hours apart.`,
      weight: 0.12,
    })
  }

  // ── Accounts created around the same time ──
  const createdGap = minutesApart(subject.accountCreatedAt, candidate.accountCreatedAt)
  if (createdGap <= 60) {
    indicators.push({
      id: 'account_age',
      label: 'Accounts created together',
      detail: `Both Discord accounts were made within ${Math.max(1, Math.round(createdGap))} minutes of each other.`,
      weight: 0.4,
    })
  } else if (createdGap <= 1440) {
    indicators.push({
      id: 'account_age',
      label: 'Accounts created the same day',
      detail: `Created ${Math.round(createdGap / 60)} hours apart.`,
      weight: 0.25,
    })
  } else if (createdGap <= 10080) {
    indicators.push({
      id: 'account_age',
      label: 'Accounts created the same week',
      detail: `Created ${Math.round(createdGap / 1440)} days apart.`,
      weight: 0.1,
    })
  }

  // ── Shared moderation history ──
  if (candidate.sharedModeration) {
    const { moderator, reason, namesSubject } = candidate.sharedModeration
    if (namesSubject) {
      indicators.push({
        id: 'moderation',
        label: 'Named in the same moderation case',
        detail: reason
          ? `A moderation record on this account references the subject: "${reason}".`
          : 'A moderation record on this account references the subject.',
        weight: 0.6,
      })
    } else {
      indicators.push({
        id: 'moderation',
        label: 'Shared moderation history',
        detail: `Both accounts were actioned${moderator ? ` by ${moderator}` : ''}${reason ? ` for "${reason}"` : ''}.`,
        weight: 0.35,
      })
    }
  }

  // ── Shared economy interactions ──
  if (candidate.sharedEconomy >= 3) {
    indicators.push({
      id: 'economy',
      label: 'Repeated coin transfers',
      detail: `${candidate.sharedEconomy} coin transfers between the two accounts.`,
      weight: 0.4,
    })
  } else if (candidate.sharedEconomy >= 1) {
    indicators.push({
      id: 'economy',
      label: 'Coin transfers',
      detail: `${candidate.sharedEconomy} coin transfer${candidate.sharedEconomy > 1 ? 's' : ''} between the two accounts.`,
      weight: 0.25,
    })
  }

  // ── Similar activity patterns ──
  // Only meaningful with real volume on both sides — two members with three
  // messages each will "match" by accident.
  if (subject.messages >= 20 && candidate.messages >= 20) {
    const overlap = hourlySimilarity(subject.hourly, candidate.hourly)
    if (overlap >= 0.9) {
      indicators.push({
        id: 'activity_pattern',
        label: 'Near-identical activity hours',
        detail: `Both accounts post at the same hours of the day (${Math.round(overlap * 100)}% overlap).`,
        weight: 0.3,
      })
    } else if (overlap >= 0.8) {
      indicators.push({
        id: 'activity_pattern',
        label: 'Similar activity hours',
        detail: `Activity patterns overlap ${Math.round(overlap * 100)}%.`,
        weight: 0.15,
      })
    }
  }

  if (indicators.length === 0) return null

  // Noisy-OR: independent pieces of evidence compound, but none of them alone —
  // and not all of them together — ever reaches certainty.
  const combined = 1 - indicators.reduce((acc, i) => acc * (1 - i.weight), 1)
  const confidence = Math.min(MAX_AUTO_CONFIDENCE, Math.round(combined * 100))

  const strongest = Math.max(...indicators.map((i) => i.weight))
  // One weak coincidence isn't a lead. Require either a strong single signal or
  // at least two independent ones, on top of the confidence floor.
  if (confidence < MIN_LINK_CONFIDENCE) return null
  if (indicators.length < 2 && strongest < 0.5) return null

  indicators.sort((a, b) => b.weight - a.weight)

  return {
    userId: candidate.userId,
    username: candidate.username,
    displayName: candidate.displayName,
    avatar: candidate.avatar,
    confidence,
    indicators,
    risk: candidate.risk,
    manual: false,
    note: null,
  }
}

/** Score every candidate and return the strongest potential links, best first. */
export function correlateAccounts(
  subject: CorrelationSubject,
  candidates: CorrelationCandidate[],
  limit = 8,
): LinkedAccount[] {
  const out: LinkedAccount[] = []
  for (const candidate of candidates) {
    const link = correlateAccount(subject, candidate)
    if (link) out.push(link)
  }
  return out
    .sort((a, b) => b.confidence - a.confidence || b.risk.score - a.risk.score)
    .slice(0, limit)
}

/** Confidence bands, for the badge colour + wording. */
export function confidenceLabel(confidence: number): { label: string; color: string } {
  if (confidence >= 80) return { label: 'Strong', color: '#f87171' }
  if (confidence >= 60) return { label: 'Likely', color: '#fb923c' }
  if (confidence >= 45) return { label: 'Possible', color: '#fbbf24' }
  return { label: 'Weak', color: '#94a3b8' }
}

// ── Investigations ────────────────────────────────────────────────────────────

export type InvestigationStatus = 'open' | 'monitoring' | 'cleared' | 'confirmed' | 'banned'

export const INVESTIGATION_STATUSES: InvestigationStatus[] = [
  'open',
  'monitoring',
  'cleared',
  'confirmed',
  'banned',
]

export const STATUS_META: Record<
  InvestigationStatus,
  { label: string; color: string; description: string; /** Closed cases leave the queue. */ resolved: boolean }
> = {
  open: {
    label: 'Open',
    color: '#60a5fa',
    description: 'Waiting on a moderator to review.',
    resolved: false,
  },
  monitoring: {
    label: 'Monitoring',
    color: '#fbbf24',
    description: 'Plausible but unproven — keeping an eye on it.',
    resolved: false,
  },
  cleared: {
    label: 'Cleared',
    color: '#34d399',
    description: 'Reviewed and found legitimate.',
    resolved: true,
  },
  confirmed: {
    label: 'Confirmed alt',
    color: '#fb923c',
    description: 'A moderator judged this an alternate account.',
    resolved: true,
  },
  banned: {
    label: 'Banned',
    color: '#f87171',
    description: 'Actioned and removed from the server.',
    resolved: true,
  },
}

export type AltInvestigation = {
  id: string
  guild_id: string
  user_id: string
  user_name: string | null
  status: InvestigationStatus
  risk_score: number
  risk_level: AltRiskLevel
  signals: string[]
  source: 'dashboard' | 'command' | 'auto'
  opened_by: string | null
  opened_by_name: string | null
  resolution: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolved_by_name: string | null
  created_at: string
  updated_at: string
}

export type InvestigationEventKind = 'note' | 'status' | 'flag' | 'link' | 'unlink' | 'lookup'

export type AltInvestigationEvent = {
  id: string
  guild_id: string
  user_id: string
  kind: InvestigationEventKind
  body: string | null
  metadata: Record<string, unknown>
  author_id: string | null
  author_name: string | null
  created_at: string
}

export type AltLink = {
  id: string
  guild_id: string
  user_id: string
  user_name: string | null
  linked_user_id: string
  linked_user_name: string | null
  confidence: number
  indicators: LinkIndicator[]
  note: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
}

export type AltLookup = {
  id: number
  guild_id: string
  user_id: string
  user_name: string | null
  risk_score: number
  risk_level: AltRiskLevel
  source: 'dashboard' | 'command'
  actor_id: string | null
  actor_name: string | null
  created_at: string
}

// ── Dashboard shapes ──────────────────────────────────────────────────────────

/** A scored account as the dashboard lists it (the full signal set is only sent
 *  for a lookup — the list needs a name, a score and the headline reasons). */
export type AltAccountSummary = {
  userId: string
  username: string
  displayName: string
  avatar: string
  joinedAt: string | null
  accountCreatedAt: string | null
  score: number
  level: AltRiskLevel
  /** Labels of the top risk signals, for the row's "why" line. */
  signals: string[]
}

export type AltDashboardStats = {
  /** Members scored (bots excluded). */
  scanned: number
  byLevel: Record<AltRiskLevel, number>
  /** High + critical — the accounts a moderator is expected to look at. */
  actionable: number
  /** Investigations still open or being monitored. */
  openCases: number
  resolvedCases: number
  /** Connected components of manually-linked accounts. */
  linkedGroups: number
}

/** Order a pair of ids the way alt_account_links stores them (smaller id first). */
export function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

export type AltLinkGroup = {
  /** Every account in the connected component, ordered by id. */
  members: { userId: string; userName: string | null }[]
  /** The links that connect them. */
  links: AltLink[]
}

/**
 * Collapse manual links into connected components — the "linked account groups"
 * the safety dashboard shows. A → B and B → C means all three are one group.
 */
export function buildLinkGroups(links: AltLink[]): AltLinkGroup[] {
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const p = parent.get(id)
    if (p == null || p === id) return id
    const root = find(p)
    parent.set(id, root)
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  const names = new Map<string, string | null>()
  for (const link of links) {
    if (!parent.has(link.user_id)) parent.set(link.user_id, link.user_id)
    if (!parent.has(link.linked_user_id)) parent.set(link.linked_user_id, link.linked_user_id)
    names.set(link.user_id, link.user_name)
    names.set(link.linked_user_id, link.linked_user_name)
    union(link.user_id, link.linked_user_id)
  }

  const groups = new Map<string, AltLinkGroup>()
  for (const id of parent.keys()) {
    const root = find(id)
    const group = groups.get(root) ?? { members: [], links: [] }
    group.members.push({ userId: id, userName: names.get(id) ?? null })
    groups.set(root, group)
  }
  for (const link of links) {
    groups.get(find(link.user_id))!.links.push(link)
  }

  return [...groups.values()]
    .map((g) => ({ ...g, members: g.members.sort((a, b) => a.userId.localeCompare(b.userId)) }))
    .sort((a, b) => b.members.length - a.members.length)
}
