// Global Economy engine (PULSIFY-45).
//
// Pulse Coins are a GLOBAL currency: one balance per Discord user, shared
// across every server running Pulse, while Levels & XP stay per-guild. This
// module is the source of truth for the earning rates, transaction vocab and
// the pure analytics builder used by the Economy view. The bot MIRRORS the
// rates in `pulse-bot/src/economy.js` — keep the two in sync (same as
// leveling.ts ↔ leveling.js).
//
// Reputation is NOT here: it stays the existing 0-100 trust score
// (lib/reputation.ts), only now computed from globally-aggregated activity
// (see get_global_member_reputation). It is computed on the fly, never stored
// and never granted — so it has no rates, ledger or tiers of its own.

import { timeframeSince, timeframeBucket, type Timeframe } from '@/lib/analytics'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

// ── Currency ─────────────────────────────────────────────────────────────────

export const CURRENCY_NAME = 'Pulse Coins'
export const CURRENCY_UNIT = 'coins'

export function formatCoins(n: number | null | undefined): string {
  return `${Math.max(0, Math.round(Number(n ?? 0))).toLocaleString()}`
}

// ── Earning rates (mirrored by economy.js) ───────────────────────────────────
//
// Activity coins ride the leveling hooks: every XP award also pays coins at
// 1 per `coinsPerXpDivisor` XP, so message cooldowns, ignored channels/roles
// and the voice anti-farm rule are inherited for free — and a guild's XP
// multiplier never inflates the global economy (coins derive from the
// pre-multiplier base).

export const ECONOMY_RATES = {
  /** Activity coins = ceil(xp / 5) for each XP award (pre-multiplier). */
  coinsPerXpDivisor: 5,
  /** Level-up bonus: 25 + 5 × new level. */
  levelUpBase: 25,
  levelUpPerLevel: 5,
  /** Fixed bonuses. */
  giveawayWinCoins: 250,
  milestoneCoins: 100,
  onboardingCoins: 50,
  /** Hard cap on a single /pay transfer. */
  maxTransfer: 1_000_000,
} as const

export function coinsForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 0
  return Math.ceil(xp / ECONOMY_RATES.coinsPerXpDivisor)
}

export function levelUpCoins(level: number): number {
  return ECONOMY_RATES.levelUpBase + ECONOMY_RATES.levelUpPerLevel * Math.max(1, level)
}

// ── Records ──────────────────────────────────────────────────────────────────

export type TransactionKind =
  | 'earn'
  | 'spend'
  | 'transfer_in'
  | 'transfer_out'
  | 'reward'
  | 'admin_grant'
  | 'admin_remove'

export const TRANSACTION_KIND_META: Record<TransactionKind, { label: string; color: string }> = {
  earn: { label: 'Earned', color: 'var(--green)' },
  spend: { label: 'Spent', color: 'var(--amber)' },
  transfer_in: { label: 'Transfer in', color: 'var(--cyan)' },
  transfer_out: { label: 'Transfer out', color: 'var(--cyan)' },
  reward: { label: 'Reward', color: 'var(--p-1)' },
  admin_grant: { label: 'Admin grant', color: 'var(--p-1)' },
  admin_remove: { label: 'Admin removal', color: 'var(--red)' },
}

export const TRANSACTION_REASON_LABELS: Record<string, string> = {
  activity: 'Server activity',
  activity_message: 'Chatting',
  activity_voice: 'Voice activity',
  activity_command: 'Command use',
  activity_reaction: 'Reactions received',
  activity_active_day: 'Active day',
  activity_helpful: 'Helpful contribution',
  level_up: 'Level up',
  milestone: 'Milestone',
  event_participation: 'Event interest',
  event_attendance: 'Event attendance',
  event_completion: 'Event reward',
  event_hosting: 'Hosted an event',
  giveaway_entry: 'Giveaway entry',
  giveaway_win: 'Giveaway win',
  giveaway_hosting: 'Hosted a giveaway',
  onboarding: 'Onboarding complete',
  onboarding_complete: 'Onboarding complete',
  onboarding_profile: 'Profile complete',
  onboarding_verify: 'Verification',
  onboarding_roles: 'Role selection',
  daily: 'Daily reward',
  weekly: 'Weekly reward',
  transfer: 'Member transfer',
  admin: 'Administrative',
}

export type EconomyUser = {
  user_id: string
  user_name: string | null
  balance: number
  lifetime_earned: number
  lifetime_spent: number
  updated_at: string | null
}

export type EconomyTransaction = {
  id: number
  user_id: string
  user_name: string | null
  guild_id: string | null
  guild_name: string | null
  amount: number
  balance_after: number
  kind: TransactionKind
  reason: string | null
  note: string | null
  counterparty_id: string | null
  counterparty_name: string | null
  actor_id: string | null
  actor_name: string | null
  created_at: string
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function normaliseEconomyUser(row: Record<string, unknown>): EconomyUser {
  return {
    user_id: String(row.user_id ?? ''),
    user_name: typeof row.user_name === 'string' ? row.user_name : null,
    balance: num(row.balance),
    lifetime_earned: num(row.lifetime_earned),
    lifetime_spent: num(row.lifetime_spent),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}

// ── Analytics (pure — fed by the economy API route) ──────────────────────────

export type EconomyTrendPoint = {
  /** ISO timestamp of the bucket start (hourly for 24h, daily otherwise). */
  bucket: string
  earned: number
  spent: number
}

export type EconomyAnalytics = {
  /** Sum of all balances — coins currently in circulation. */
  circulation: number
  /** Within the window: */
  earned: number
  spent: number
  transferVolume: number
  adminGranted: number
  adminRemoved: number
  transactionCount: number
  activeUsers: number
  trend: EconomyTrendPoint[]
  topEarners: { user_id: string; user_name: string | null; amount: number }[]
}

/**
 * Aggregate a window of coin-ledger rows into the Overview analytics.
 * `circulation` comes from the users table (sum of balances); the rest is
 * derived from the rows. The trend buckets match the analytics/statistics
 * views — hourly for 24h, daily otherwise, zero-filled across the window so
 * the chart has a continuous axis ('all' just sorts the buckets that exist).
 */
export function buildEconomyAnalytics(
  transactions: EconomyTransaction[],
  circulation: number,
  timeframe: Timeframe,
): EconomyAnalytics {
  let earned = 0
  let spent = 0
  let transferVolume = 0
  let adminGranted = 0
  let adminRemoved = 0

  const stepMs = timeframeBucket(timeframe) === 'hour' ? HOUR_MS : DAY_MS
  const bucketStart = (iso: string) => Math.floor(new Date(iso).getTime() / stepMs) * stepMs
  const byBucket = new Map<number, EconomyTrendPoint>()
  const trendBucket = (iso: string) => {
    const key = bucketStart(iso)
    let p = byBucket.get(key)
    if (!p) {
      p = { bucket: new Date(key).toISOString(), earned: 0, spent: 0 }
      byBucket.set(key, p)
    }
    return p
  }

  const earnedByUser = new Map<string, { user_id: string; user_name: string | null; amount: number }>()
  const users = new Set<string>()

  for (const t of transactions) {
    users.add(t.user_id)
    if (t.amount > 0) {
      // transfer_in just moves coins around — exclude it from "earned".
      if (t.kind !== 'transfer_in') {
        earned += t.amount
        trendBucket(t.created_at).earned += t.amount
        const e = earnedByUser.get(t.user_id) ?? { user_id: t.user_id, user_name: t.user_name, amount: 0 }
        e.amount += t.amount
        if (t.user_name) e.user_name = t.user_name
        earnedByUser.set(t.user_id, e)
      }
      if (t.kind === 'admin_grant') adminGranted += t.amount
      if (t.kind === 'transfer_in') transferVolume += t.amount
    } else if (t.amount < 0) {
      if (t.kind !== 'transfer_out') {
        spent += -t.amount
        trendBucket(t.created_at).spent += -t.amount
      }
      if (t.kind === 'admin_remove') adminRemoved += -t.amount
    }
  }

  // Zero-fill the window so the chart axis is continuous (mirrors
  // fillTimeseries); 'all' has no fixed start, so just sort what we have.
  let trend: EconomyTrendPoint[]
  if (timeframe === 'all') {
    trend = [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)
  } else {
    const start = Math.floor(new Date(timeframeSince(timeframe)!).getTime() / stepMs) * stepMs
    const now = Date.now()
    trend = []
    for (let t = start; t <= now; t += stepMs) {
      trend.push(byBucket.get(t) ?? { bucket: new Date(t).toISOString(), earned: 0, spent: 0 })
    }
  }

  const topEarners = [...earnedByUser.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)

  return {
    circulation,
    earned,
    spent,
    transferVolume,
    adminGranted,
    adminRemoved,
    transactionCount: transactions.length,
    activeUsers: users.size,
    trend,
    topEarners,
  }
}

// ── Admin adjustment limits (shared by API + UI validation) ──────────────────

export const ADMIN_ADJUST_LIMITS = {
  maxCoins: 10_000_000,
  maxNote: 300,
} as const
