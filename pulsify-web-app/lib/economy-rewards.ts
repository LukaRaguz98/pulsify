// Economy Rewards & Earning engine (PULSIFY-47).
//
// PULSIFY-45 introduced a global Pulse Coins balance with a handful of FIXED
// earning rates baked into lib/economy.ts. This module turns those fixed rates
// into a per-guild, fully configurable earning system: server owners decide
// which sources pay out, how much, with what cooldowns/caps, and which
// multipliers apply. The bot is the writer (it reads this config and grants
// coins through the atomic economy_* RPCs); the dashboard owns the config row
// (`economy_reward_settings`) and the Earning view.
//
// IMPORTANT — Reputation is NOT earnable here. It stays the existing 0-100
// trust score (lib/reputation.ts), computed on the fly from globally-aggregated
// activity, never stored and never "granted" (a deliberate PULSIFY-45 decision).
// PULSIFY-47 expands its usefulness instead by letting a member's reputation act
// as an *earning multiplier* (see `multipliers.reputation`) — higher trust, more
// coins — without ever turning reputation into a points balance.
//
// This file MIRRORS pulse-bot/src/economy-rewards.js — keep the pure helpers
// (defaults, normalise/serialise, multipliers, streaks, simulate) in sync, same
// as lib/leveling.ts ↔ leveling.js. The analytics builder is web-only.

import { timeframeSince, timeframeBucket, type Timeframe } from '@/lib/analytics'
import { coinsForXp } from '@/lib/economy'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

// ── Reward source catalogue ──────────────────────────────────────────────────
//
// Every way a member can earn Pulse Coins, grouped into the categories the
// Earning view renders. `reason` is the machine value written to the ledger
// (economy_transactions.reason) and recognised by lib/economy's
// TRANSACTION_REASON_LABELS / the /wallet describer.

export type RewardCategory =
  | 'activity'
  | 'event'
  | 'giveaway'
  | 'onboarding'
  | 'progression'
  | 'daily'

export type RewardSourceMeta = {
  /** Stable key inside its category's config object. */
  key: string
  category: RewardCategory
  /** Ledger reason written when this source pays out. */
  reason: string
  label: string
  description: string
  /** Whether this source supports a per-payout cooldown + daily cap (hot, repeatable activity). */
  rateLimited?: boolean
}

export const REWARD_SOURCES: RewardSourceMeta[] = [
  // Activity — repeatable, rate-limited.
  { key: 'message', category: 'activity', reason: 'activity_message', label: 'Messages sent', description: 'Coins for chatting. Honours the cooldown and ignored channels/roles below.', rateLimited: true },
  { key: 'voice', category: 'activity', reason: 'activity_voice', label: 'Voice activity', description: 'Coins per minute spent in a voice channel with at least one other member.', rateLimited: true },
  { key: 'command', category: 'activity', reason: 'activity_command', label: 'Command use', description: 'Coins for running the bot’s slash commands.', rateLimited: true },
  { key: 'reaction', category: 'activity', reason: 'activity_reaction', label: 'Reactions received', description: 'Coins for the message author when others react to their message.', rateLimited: true },
  { key: 'activeDay', category: 'activity', reason: 'activity_active_day', label: 'Active day', description: 'A one-off bonus the first time a member is active each day.', rateLimited: false },
  { key: 'helpful', category: 'activity', reason: 'activity_helpful', label: 'Helpful contribution', description: 'Coins for resolving a support ticket — recognising members who help others.', rateLimited: false },

  // Events.
  { key: 'participation', category: 'event', reason: 'event_participation', label: 'Event interest', description: 'A member marks interest in (RSVPs to) a scheduled event.' },
  { key: 'attendance', category: 'event', reason: 'event_attendance', label: 'Event attendance', description: 'A member is in the event’s voice/stage channel when it goes live.' },
  { key: 'completion', category: 'event', reason: 'event_completion', label: 'Event completion', description: 'Interested members are rewarded when an event ends.' },
  { key: 'hosting', category: 'event', reason: 'event_hosting', label: 'Event hosting', description: 'The member who created the scheduled event.' },

  // Giveaways.
  { key: 'participation', category: 'giveaway', reason: 'giveaway_entry', label: 'Giveaway entry', description: 'A member joins a giveaway.' },
  { key: 'win', category: 'giveaway', reason: 'giveaway_win', label: 'Giveaway win', description: 'A member wins a giveaway.' },
  { key: 'hosting', category: 'giveaway', reason: 'giveaway_hosting', label: 'Giveaway hosting', description: 'The member who created the giveaway, paid when it ends.' },

  // Onboarding.
  { key: 'completion', category: 'onboarding', reason: 'onboarding_complete', label: 'Onboarding complete', description: 'A member finishes the onboarding panel.' },
  { key: 'profile', category: 'onboarding', reason: 'onboarding_profile', label: 'Profile complete', description: 'A member sets up their profile (avatar + about).' },
  { key: 'verification', category: 'onboarding', reason: 'onboarding_verify', label: 'Verification', description: 'A member passes verification.' },
  { key: 'roleSelection', category: 'onboarding', reason: 'onboarding_roles', label: 'Role selection', description: 'A member picks at least one self-assignable role.' },

  // Progression.
  { key: 'levelUp', category: 'progression', reason: 'level_up', label: 'Level up', description: 'A scaling bonus each time a member reaches a new level.' },
  { key: 'milestone', category: 'progression', reason: 'milestone', label: 'Milestone reached', description: 'A member crosses a recognition milestone.' },

  // Daily / weekly.
  { key: 'daily', category: 'daily', reason: 'daily', label: 'Daily reward', description: 'A coin claim available once a day, with a growing streak bonus.' },
  { key: 'weekly', category: 'daily', reason: 'weekly', label: 'Weekly reward', description: 'A larger claim available once a week, with its own streak.' },
]

// Ledger reasons this module is responsible for — used by the analytics
// breakdown so an admin grant or /pay transfer doesn't show up as a "source".
export const REWARD_REASONS = new Set(REWARD_SOURCES.map((s) => s.reason))

export const REWARD_REASON_LABELS: Record<string, string> = Object.fromEntries(
  REWARD_SOURCES.map((s) => [s.reason, `${s.label}`]),
)

// ── Config shape ──────────────────────────────────────────────────────────────

export type RateLimitedSource = { enabled: boolean; amount: number; cooldownSeconds: number; dailyCap: number }
export type FlatSource = { enabled: boolean; amount: number }
export type StreakMilestone = { streak: number; bonus: number }
export type StreakSource = {
  enabled: boolean
  amount: number
  streakBonus: number
  streakMax: number
  milestones: StreakMilestone[]
}

export type MultiplierConfig = {
  reputation: { enabled: boolean; maxBonusPct: number }
  event: { enabled: boolean; value: number }
  booster: { enabled: boolean; value: number }
  premium: { enabled: boolean; value: number }
  seasonal: { enabled: boolean; value: number; label: string; startsAt: string | null; endsAt: string | null }
}

export type RewardConfig = {
  enabled: boolean
  activity: {
    message: RateLimitedSource
    voice: RateLimitedSource
    command: RateLimitedSource
    reaction: RateLimitedSource
    activeDay: FlatSource
    helpful: FlatSource
  }
  event: { participation: FlatSource; attendance: FlatSource; completion: FlatSource; hosting: FlatSource }
  giveaway: { participation: FlatSource; win: FlatSource; hosting: FlatSource; multiplier: number }
  onboarding: { completion: FlatSource; profile: FlatSource; verification: FlatSource; roleSelection: FlatSource }
  progression: { levelUp: { enabled: boolean; base: number; perLevel: number }; milestone: FlatSource }
  daily: StreakSource
  weekly: StreakSource
  multipliers: MultiplierConfig
  antiAbuse: {
    ignoredChannelIds: string[]
    ignoredRoleIds: string[]
    minAccountAgeDays: number
    globalDailyCap: number
  }
  notify: { dm: boolean; channelId: string | null }
}

export const REWARD_LIMITS = {
  maxAmount: 1_000_000,
  maxCooldownSeconds: 86_400,
  maxDailyCap: 10_000_000,
  maxMultiplier: 10,
  maxBonusPct: 500,
  maxStreakBonus: 1_000_000,
  maxMilestones: 10,
  maxStreak: 100_000,
  maxIgnored: 100,
  maxAccountAgeDays: 365,
  maxLabel: 60,
} as const

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}
function clampFloat(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}
function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
}
function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

// Defaults preserve the PULSIFY-45 fixed rates so turning this feature on
// changes nothing until an admin tweaks it: activity ≈ ceil(xp/5) ≈ a couple
// of coins a message, level-up 25+5·lvl, giveaway win 250, milestone 100,
// onboarding 50.
export function defaultRewardConfig(): RewardConfig {
  return {
    enabled: true,
    activity: {
      message: { enabled: true, amount: 4, cooldownSeconds: 60, dailyCap: 500 },
      voice: { enabled: true, amount: 1, cooldownSeconds: 0, dailyCap: 500 },
      command: { enabled: false, amount: 1, cooldownSeconds: 60, dailyCap: 100 },
      reaction: { enabled: true, amount: 1, cooldownSeconds: 30, dailyCap: 100 },
      activeDay: { enabled: true, amount: 25 },
      helpful: { enabled: true, amount: 50 },
    },
    event: {
      participation: { enabled: true, amount: 25 },
      attendance: { enabled: true, amount: 50 },
      completion: { enabled: true, amount: 75 },
      hosting: { enabled: true, amount: 150 },
    },
    giveaway: {
      participation: { enabled: true, amount: 10 },
      win: { enabled: true, amount: 250 },
      hosting: { enabled: true, amount: 50 },
      multiplier: 1,
    },
    onboarding: {
      completion: { enabled: true, amount: 50 },
      profile: { enabled: true, amount: 25 },
      verification: { enabled: true, amount: 25 },
      roleSelection: { enabled: true, amount: 15 },
    },
    progression: {
      levelUp: { enabled: true, base: 25, perLevel: 5 },
      milestone: { enabled: true, amount: 100 },
    },
    daily: {
      enabled: true,
      amount: 50,
      streakBonus: 5,
      streakMax: 200,
      milestones: [
        { streak: 7, bonus: 100 },
        { streak: 30, bonus: 500 },
      ],
    },
    weekly: {
      enabled: true,
      amount: 250,
      streakBonus: 25,
      streakMax: 500,
      milestones: [{ streak: 4, bonus: 500 }],
    },
    multipliers: {
      reputation: { enabled: false, maxBonusPct: 50 },
      event: { enabled: false, value: 1.5 },
      booster: { enabled: true, value: 1.5 },
      premium: { enabled: false, value: 1.25 },
      seasonal: { enabled: false, value: 2, label: '', startsAt: null, endsAt: null },
    },
    antiAbuse: {
      ignoredChannelIds: [],
      ignoredRoleIds: [],
      minAccountAgeDays: 0,
      globalDailyCap: 0,
    },
    notify: { dm: false, channelId: null },
  }
}

function normRateLimited(raw: unknown, def: RateLimitedSource): RateLimitedSource {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    enabled: bool(s.enabled, def.enabled),
    amount: clampInt(s.amount, 0, REWARD_LIMITS.maxAmount, def.amount),
    cooldownSeconds: clampInt(s.cooldownSeconds, 0, REWARD_LIMITS.maxCooldownSeconds, def.cooldownSeconds),
    dailyCap: clampInt(s.dailyCap, 0, REWARD_LIMITS.maxDailyCap, def.dailyCap),
  }
}
function normFlat(raw: unknown, def: FlatSource): FlatSource {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { enabled: bool(s.enabled, def.enabled), amount: clampInt(s.amount, 0, REWARD_LIMITS.maxAmount, def.amount) }
}
function normMilestones(raw: unknown, def: StreakMilestone[]): StreakMilestone[] {
  if (!Array.isArray(raw)) return def
  const seen = new Set<number>()
  const out: StreakMilestone[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const streak = clampInt((m as Record<string, unknown>).streak, 1, REWARD_LIMITS.maxStreak, 0)
    const bonus = clampInt((m as Record<string, unknown>).bonus, 0, REWARD_LIMITS.maxStreakBonus, 0)
    if (streak < 1 || bonus < 1 || seen.has(streak)) continue
    seen.add(streak)
    out.push({ streak, bonus })
  }
  return out.sort((a, b) => a.streak - b.streak).slice(0, REWARD_LIMITS.maxMilestones)
}
function normStreak(raw: unknown, def: StreakSource): StreakSource {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    enabled: bool(s.enabled, def.enabled),
    amount: clampInt(s.amount, 0, REWARD_LIMITS.maxAmount, def.amount),
    streakBonus: clampInt(s.streakBonus, 0, REWARD_LIMITS.maxStreakBonus, def.streakBonus),
    streakMax: clampInt(s.streakMax, 0, REWARD_LIMITS.maxStreakBonus, def.streakMax),
    milestones: normMilestones(s.milestones, def.milestones),
  }
}
function normMult(raw: unknown, def: { enabled: boolean; value: number }): { enabled: boolean; value: number } {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { enabled: bool(s.enabled, def.enabled), value: clampFloat(s.value, 1, REWARD_LIMITS.maxMultiplier, def.value) }
}

export function normaliseRewardSettings(row: { enabled?: unknown; settings?: unknown } | null): RewardConfig {
  const base = defaultRewardConfig()
  if (!row) return base
  const enabled = bool(row.enabled, base.enabled)
  const s = (row.settings && typeof row.settings === 'object' ? row.settings : {}) as Record<string, unknown>
  const a = (s.activity && typeof s.activity === 'object' ? s.activity : {}) as Record<string, unknown>
  const ev = (s.event && typeof s.event === 'object' ? s.event : {}) as Record<string, unknown>
  const gw = (s.giveaway && typeof s.giveaway === 'object' ? s.giveaway : {}) as Record<string, unknown>
  const ob = (s.onboarding && typeof s.onboarding === 'object' ? s.onboarding : {}) as Record<string, unknown>
  const pr = (s.progression && typeof s.progression === 'object' ? s.progression : {}) as Record<string, unknown>
  const mu = (s.multipliers && typeof s.multipliers === 'object' ? s.multipliers : {}) as Record<string, unknown>
  const aa = (s.antiAbuse && typeof s.antiAbuse === 'object' ? s.antiAbuse : {}) as Record<string, unknown>
  const nt = (s.notify && typeof s.notify === 'object' ? s.notify : {}) as Record<string, unknown>
  const lvl = (pr.levelUp && typeof pr.levelUp === 'object' ? pr.levelUp : {}) as Record<string, unknown>
  const rep = (mu.reputation && typeof mu.reputation === 'object' ? mu.reputation : {}) as Record<string, unknown>
  const sea = (mu.seasonal && typeof mu.seasonal === 'object' ? mu.seasonal : {}) as Record<string, unknown>

  return {
    enabled,
    activity: {
      message: normRateLimited(a.message, base.activity.message),
      voice: normRateLimited(a.voice, base.activity.voice),
      command: normRateLimited(a.command, base.activity.command),
      reaction: normRateLimited(a.reaction, base.activity.reaction),
      activeDay: normFlat(a.activeDay, base.activity.activeDay),
      helpful: normFlat(a.helpful, base.activity.helpful),
    },
    event: {
      participation: normFlat(ev.participation, base.event.participation),
      attendance: normFlat(ev.attendance, base.event.attendance),
      completion: normFlat(ev.completion, base.event.completion),
      hosting: normFlat(ev.hosting, base.event.hosting),
    },
    giveaway: {
      participation: normFlat(gw.participation, base.giveaway.participation),
      win: normFlat(gw.win, base.giveaway.win),
      hosting: normFlat(gw.hosting, base.giveaway.hosting),
      multiplier: clampFloat(gw.multiplier, 1, REWARD_LIMITS.maxMultiplier, base.giveaway.multiplier),
    },
    onboarding: {
      completion: normFlat(ob.completion, base.onboarding.completion),
      profile: normFlat(ob.profile, base.onboarding.profile),
      verification: normFlat(ob.verification, base.onboarding.verification),
      roleSelection: normFlat(ob.roleSelection, base.onboarding.roleSelection),
    },
    progression: {
      levelUp: {
        enabled: bool(lvl.enabled, base.progression.levelUp.enabled),
        base: clampInt(lvl.base, 0, REWARD_LIMITS.maxAmount, base.progression.levelUp.base),
        perLevel: clampInt(lvl.perLevel, 0, REWARD_LIMITS.maxAmount, base.progression.levelUp.perLevel),
      },
      milestone: normFlat(pr.milestone, base.progression.milestone),
    },
    daily: normStreak(s.daily, base.daily),
    weekly: normStreak(s.weekly, base.weekly),
    multipliers: {
      reputation: {
        enabled: bool(rep.enabled, base.multipliers.reputation.enabled),
        maxBonusPct: clampInt(rep.maxBonusPct, 0, REWARD_LIMITS.maxBonusPct, base.multipliers.reputation.maxBonusPct),
      },
      event: normMult(mu.event, base.multipliers.event),
      booster: normMult(mu.booster, base.multipliers.booster),
      premium: normMult(mu.premium, base.multipliers.premium),
      seasonal: {
        enabled: bool(sea.enabled, base.multipliers.seasonal.enabled),
        value: clampFloat(sea.value, 1, REWARD_LIMITS.maxMultiplier, base.multipliers.seasonal.value),
        label: typeof sea.label === 'string' ? sea.label.slice(0, REWARD_LIMITS.maxLabel) : base.multipliers.seasonal.label,
        startsAt: isoOrNull(sea.startsAt),
        endsAt: isoOrNull(sea.endsAt),
      },
    },
    antiAbuse: {
      ignoredChannelIds: toStringArray(aa.ignoredChannelIds).slice(0, REWARD_LIMITS.maxIgnored),
      ignoredRoleIds: toStringArray(aa.ignoredRoleIds).slice(0, REWARD_LIMITS.maxIgnored),
      minAccountAgeDays: clampInt(aa.minAccountAgeDays, 0, REWARD_LIMITS.maxAccountAgeDays, base.antiAbuse.minAccountAgeDays),
      globalDailyCap: clampInt(aa.globalDailyCap, 0, REWARD_LIMITS.maxDailyCap, base.antiAbuse.globalDailyCap),
    },
    notify: {
      dm: bool(nt.dm, base.notify.dm),
      channelId: typeof nt.channelId === 'string' && nt.channelId ? nt.channelId : null,
    },
  }
}

/** The jsonb we persist — the normalised config minus the top-level `enabled`
 * (which is its own column, matching leveling_settings). */
export function serialiseRewardSettings(cfg: RewardConfig): Omit<RewardConfig, 'enabled'> {
  const { enabled: _enabled, ...rest } = cfg
  return rest
}

// ── Multipliers ───────────────────────────────────────────────────────────────

export type MultiplierContext = {
  category: RewardCategory
  /** 0-100 computed reputation, or null when unknown. */
  reputation?: number | null
  isBooster?: boolean
  isPremium?: boolean
  /** Defaults to Date.now() — injectable for tests. */
  now?: number
}

export type AppliedMultiplier = { key: string; label: string; factor: number }

/**
 * The multipliers that apply to a single payout, in stack order. Pure so the
 * dashboard simulator and the bot compute identically. Multipliers stack
 * multiplicatively; the combined factor is clamped to maxMultiplier so a
 * misconfiguration can't mint runaway coins.
 */
export function activeMultipliers(cfg: RewardConfig, ctx: MultiplierContext): AppliedMultiplier[] {
  const m = cfg.multipliers
  const out: AppliedMultiplier[] = []
  if (m.reputation.enabled && m.reputation.maxBonusPct > 0 && typeof ctx.reputation === 'number') {
    const factor = 1 + (Math.max(0, Math.min(100, ctx.reputation)) / 100) * (m.reputation.maxBonusPct / 100)
    if (factor > 1) out.push({ key: 'reputation', label: 'Reputation', factor })
  }
  if (m.event.enabled && ctx.category === 'event' && m.event.value > 1) {
    out.push({ key: 'event', label: 'Event', factor: m.event.value })
  }
  if (m.booster.enabled && ctx.isBooster && m.booster.value > 1) {
    out.push({ key: 'booster', label: 'Server booster', factor: m.booster.value })
  }
  if (m.premium.enabled && ctx.isPremium && m.premium.value > 1) {
    out.push({ key: 'premium', label: 'Premium', factor: m.premium.value })
  }
  if (m.seasonal.enabled && m.seasonal.value > 1 && seasonalActive(m.seasonal, ctx.now ?? Date.now())) {
    out.push({ key: 'seasonal', label: m.seasonal.label || 'Seasonal', factor: m.seasonal.value })
  }
  return out
}

export function seasonalActive(s: MultiplierConfig['seasonal'], now: number): boolean {
  if (!s.enabled) return false
  if (s.startsAt && now < Date.parse(s.startsAt)) return false
  if (s.endsAt && now > Date.parse(s.endsAt)) return false
  return true
}

/** Combined multiplier factor (clamped), and the breakdown that produced it. */
export function combinedMultiplier(cfg: RewardConfig, ctx: MultiplierContext): { factor: number; applied: AppliedMultiplier[] } {
  const applied = activeMultipliers(cfg, ctx)
  const raw = applied.reduce((f, a) => f * a.factor, 1)
  return { factor: Math.min(raw, REWARD_LIMITS.maxMultiplier), applied }
}

/** Apply multipliers to a base payout and round. */
export function applyMultipliers(base: number, cfg: RewardConfig, ctx: MultiplierContext): number {
  if (base <= 0) return 0
  return Math.max(0, Math.round(base * combinedMultiplier(cfg, ctx).factor))
}

// ── Streaks ───────────────────────────────────────────────────────────────────

/** UTC day index (days since epoch) — daily claims reset at UTC midnight. */
export function dayIndex(ms: number): number {
  return Math.floor(ms / DAY_MS)
}
/** UTC week index — weekly claims reset weekly (epoch was a Thursday; the exact
 * weekday boundary doesn't matter as long as it's consistent). */
export function weekIndex(ms: number): number {
  return Math.floor(ms / (DAY_MS * 7))
}

export type StreakResult = {
  /** Whether the claim is allowed (a new period since last claim). */
  claimable: boolean
  /** The new streak count after this claim (1 if reset, prev+1 if consecutive). */
  streak: number
  /** Base + streak bonus + any milestone bonus hit exactly at this streak. */
  amount: number
  base: number
  streakBonus: number
  milestoneBonus: number
}

/**
 * Resolve a daily/weekly claim. `lastIndex` is the period index of the previous
 * claim (null if never claimed), `prevStreak` the streak as of that claim.
 * Pure — the bot calls this inside the atomic claim RPC's read-modify-write and
 * the simulator previews it. `periodFn` is dayIndex / weekIndex.
 */
export function resolveStreakClaim(
  cfg: StreakSource,
  nowMs: number,
  lastIndex: number | null,
  prevStreak: number,
  periodFn: (ms: number) => number = dayIndex,
): StreakResult {
  const idx = periodFn(nowMs)
  const base = cfg.amount
  if (lastIndex !== null && idx <= lastIndex) {
    return { claimable: false, streak: prevStreak, amount: 0, base, streakBonus: 0, milestoneBonus: 0 }
  }
  const consecutive = lastIndex !== null && idx === lastIndex + 1
  const streak = consecutive ? Math.max(1, prevStreak) + 1 : 1
  const streakBonus = Math.min(cfg.streakMax, cfg.streakBonus * (streak - 1))
  const milestoneBonus = cfg.milestones.find((m) => m.streak === streak)?.bonus ?? 0
  return { claimable: true, streak, amount: base + streakBonus + milestoneBonus, base, streakBonus, milestoneBonus }
}

// ── Simulation (Earning view calculator) ───────────────────────────────────────

export type SimulationInput = {
  category: RewardCategory
  /** Source key within the category (e.g. 'message', 'win', 'levelUp'). */
  key: string
  /** For level-up: the level. For streak: the streak count. */
  n?: number
  reputation?: number | null
  isBooster?: boolean
  isPremium?: boolean
  now?: number
}

export type SimulationResult = {
  enabled: boolean
  base: number
  multiplier: number
  applied: AppliedMultiplier[]
  total: number
}

/** Resolve the configured base payout for a source (pre-multiplier). */
export function baseAmountFor(cfg: RewardConfig, category: RewardCategory, key: string, n = 1): { enabled: boolean; base: number } {
  switch (category) {
    case 'activity': {
      const src = (cfg.activity as Record<string, FlatSource | RateLimitedSource>)[key]
      return src ? { enabled: src.enabled, base: src.amount } : { enabled: false, base: 0 }
    }
    case 'event': {
      const src = (cfg.event as Record<string, FlatSource>)[key]
      return src ? { enabled: src.enabled, base: src.amount } : { enabled: false, base: 0 }
    }
    case 'giveaway': {
      if (key === 'multiplier') return { enabled: false, base: 0 }
      const src = (cfg.giveaway as unknown as Record<string, FlatSource>)[key]
      // Giveaway sources also carry a category multiplier on the base payout.
      return src ? { enabled: src.enabled, base: Math.round(src.amount * cfg.giveaway.multiplier) } : { enabled: false, base: 0 }
    }
    case 'onboarding': {
      const src = (cfg.onboarding as Record<string, FlatSource>)[key]
      return src ? { enabled: src.enabled, base: src.amount } : { enabled: false, base: 0 }
    }
    case 'progression': {
      if (key === 'levelUp') {
        const l = cfg.progression.levelUp
        return { enabled: l.enabled, base: l.base + l.perLevel * Math.max(1, n) }
      }
      return { enabled: cfg.progression.milestone.enabled, base: cfg.progression.milestone.amount }
    }
    case 'daily': {
      const src = key === 'weekly' ? cfg.weekly : cfg.daily
      const streakBonus = Math.min(src.streakMax, src.streakBonus * Math.max(0, n - 1))
      const milestoneBonus = src.milestones.find((m) => m.streak === n)?.bonus ?? 0
      return { enabled: src.enabled, base: src.amount + streakBonus + milestoneBonus }
    }
  }
}

export function simulateReward(cfg: RewardConfig, input: SimulationInput): SimulationResult {
  const { enabled, base } = baseAmountFor(cfg, input.category, input.key, input.n ?? 1)
  const { factor, applied } = combinedMultiplier(cfg, {
    category: input.category,
    reputation: input.reputation,
    isBooster: input.isBooster,
    isPremium: input.isPremium,
    now: input.now,
  })
  const active = cfg.enabled && enabled
  return {
    enabled: active,
    base,
    multiplier: factor,
    applied,
    total: active ? Math.max(0, Math.round(base * factor)) : 0,
  }
}

// Re-export so callers needing the legacy "coins per xp" relation (e.g. a
// migration-time preview) don't reach back into lib/economy directly.
export { coinsForXp }

// ── Analytics (web-only — fed by the rewards API route) ─────────────────────────

export type RewardSourceBreakdown = { reason: string; label: string; category: RewardCategory; amount: number; count: number }

export type RewardAnalytics = {
  /** Coins minted by reward sources in the window (excludes transfers/admin grants). */
  generated: number
  /** Number of reward payouts in the window. */
  distributed: number
  /** Distinct members who earned in the window. */
  earners: number
  /** Per-source totals, richest first (the "most valuable activities" view). */
  breakdown: RewardSourceBreakdown[]
  /** Top earners across reward sources in the window. */
  topEarners: { user_id: string; user_name: string | null; amount: number }[]
  trend: { bucket: string; generated: number }[]
}

type LedgerRow = {
  user_id: string
  user_name: string | null
  amount: number
  reason: string | null
  created_at: string
}

const CATEGORY_BY_REASON: Record<string, RewardCategory> = Object.fromEntries(
  REWARD_SOURCES.map((s) => [s.reason, s.category]),
)

/**
 * Aggregate a window of ledger rows into the Earning view's analytics. Only
 * positive rows whose `reason` is a known reward source count — transfers,
 * spends and admin grants are someone else's story. Zero-filled trend matches
 * buildEconomyAnalytics.
 */
export function buildRewardAnalytics(rows: LedgerRow[], timeframe: Timeframe): RewardAnalytics {
  let generated = 0
  let distributed = 0
  const earners = new Set<string>()
  const byReason = new Map<string, RewardSourceBreakdown>()
  const byUser = new Map<string, { user_id: string; user_name: string | null; amount: number }>()

  const stepMs = timeframeBucket(timeframe) === 'hour' ? HOUR_MS : DAY_MS
  const bucketStart = (iso: string) => Math.floor(new Date(iso).getTime() / stepMs) * stepMs
  const byBucket = new Map<number, { bucket: string; generated: number }>()

  for (const r of rows) {
    const reason = r.reason ?? ''
    if (r.amount <= 0 || !REWARD_REASONS.has(reason)) continue
    generated += r.amount
    distributed += 1
    earners.add(r.user_id)

    const b = byReason.get(reason) ?? {
      reason,
      label: REWARD_REASON_LABELS[reason] ?? reason,
      category: CATEGORY_BY_REASON[reason] ?? 'activity',
      amount: 0,
      count: 0,
    }
    b.amount += r.amount
    b.count += 1
    byReason.set(reason, b)

    const u = byUser.get(r.user_id) ?? { user_id: r.user_id, user_name: r.user_name, amount: 0 }
    u.amount += r.amount
    if (r.user_name) u.user_name = r.user_name
    byUser.set(r.user_id, u)

    const key = bucketStart(r.created_at)
    const p = byBucket.get(key) ?? { bucket: new Date(key).toISOString(), generated: 0 }
    p.generated += r.amount
    byBucket.set(key, p)
  }

  let trend: { bucket: string; generated: number }[]
  if (timeframe === 'all') {
    trend = [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)
  } else {
    const start = Math.floor(new Date(timeframeSince(timeframe)!).getTime() / stepMs) * stepMs
    const now = Date.now()
    trend = []
    for (let t = start; t <= now; t += stepMs) {
      trend.push(byBucket.get(t) ?? { bucket: new Date(t).toISOString(), generated: 0 })
    }
  }

  return {
    generated,
    distributed,
    earners: earners.size,
    breakdown: [...byReason.values()].sort((a, b) => b.amount - a.amount),
    topEarners: [...byUser.values()].sort((a, b) => b.amount - a.amount).slice(0, 10),
    trend,
  }
}
