// Levels & XP — pure config + curve helpers (PULSIFY-26).
//
// Companion to lib/reputation.ts. Reputation is a derived 0–100 score (never
// stored); XP is *cumulative and persistent* (the bot writes member_levels) and
// a member's level is derived from their XP via a configurable curve.
//
// No JSX / framework / IO imports live here — icons are referenced by lucide
// NAME (resolved in the UI layer), exactly like lib/giveaways.ts / lib/tickets.ts
// / lib/insights.ts. The bot mirrors the pieces it needs (curve math, settings
// normalisation, reward resolution, message templating) in
// pulse-bot/src/leveling.js — keep the two in sync the same way
// lib/giveaways.ts ↔ giveaways.js are.

// ── XP curve ──────────────────────────────────────────────────────────────────
// MEE6-style polynomial: the XP needed to advance FROM level L to L+1 is
//   quadratic·L² + factor·L + base
// so the cost rises smoothly with each level. xpForLevel(L) is the cumulative
// XP required to *reach* level L (reaching level 0 costs 0).

export type LevelCurve = {
  base: number
  factor: number
  quadratic: number
}

export const DEFAULT_CURVE: LevelCurve = { base: 100, factor: 50, quadratic: 5 }

/** Hard ceiling so a pathological curve can't spin levelForXp forever. */
export const MAX_LEVEL = 1000

function normaliseCurve(raw: unknown): LevelCurve {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    base: clampNum(r.base, 1, 100_000, DEFAULT_CURVE.base),
    factor: clampNum(r.factor, 0, 100_000, DEFAULT_CURVE.factor),
    quadratic: clampNum(r.quadratic, 0, 10_000, DEFAULT_CURVE.quadratic),
  }
}

/** XP to advance from level `l` to `l + 1`. */
export function xpToAdvance(level: number, curve: LevelCurve = DEFAULT_CURVE): number {
  const l = Math.max(0, level)
  return curve.quadratic * l * l + curve.factor * l + curve.base
}

/** Cumulative XP required to *reach* `level` (reaching level 0 = 0 XP). */
export function xpForLevel(level: number, curve: LevelCurve = DEFAULT_CURVE): number {
  let total = 0
  const target = Math.min(Math.max(0, Math.floor(level)), MAX_LEVEL)
  for (let l = 0; l < target; l++) total += xpToAdvance(l, curve)
  return total
}

/** The level a member with `totalXp` has reached. */
export function levelForXp(totalXp: number, curve: LevelCurve = DEFAULT_CURVE): number {
  const xp = Math.max(0, totalXp)
  let level = 0
  let cost = xpForLevel(1, curve)
  while (xp >= cost && level < MAX_LEVEL) {
    level++
    cost += xpToAdvance(level, curve)
  }
  return level
}

export type LevelProgress = {
  level: number
  totalXp: number
  /** Cumulative XP at the start of the current level. */
  levelStartXp: number
  /** Cumulative XP needed to reach the next level. */
  nextLevelXp: number
  /** XP earned within the current level. */
  intoLevel: number
  /** XP span of the current level (nextLevelXp − levelStartXp). */
  span: number
  /** XP still needed to reach the next level. */
  toNext: number
  /** Progress through the current level, 0–100 (rounded). */
  pct: number
}

/** Full progress breakdown for a member — drives the dashboard progress bars. */
export function progressInLevel(totalXp: number, curve: LevelCurve = DEFAULT_CURVE): LevelProgress {
  const xp = Math.max(0, Math.floor(totalXp))
  const level = levelForXp(xp, curve)
  const levelStartXp = xpForLevel(level, curve)
  const nextLevelXp = xpForLevel(level + 1, curve)
  const span = Math.max(1, nextLevelXp - levelStartXp)
  const intoLevel = xp - levelStartXp
  const toNext = Math.max(0, nextLevelXp - xp)
  return {
    level,
    totalXp: xp,
    levelStartXp,
    nextLevelXp,
    intoLevel,
    span,
    toNext,
    pct: Math.max(0, Math.min(100, Math.round((intoLevel / span) * 100))),
  }
}

// ── Level badge (UI indicator) ────────────────────────────────────────────────
// A colour ramp so higher levels read as more prestigious. Colours use the same
// CSS-var palette as the reputation tiers (badges.tsx). Web-only — the bot has
// no use for badge colours, so this is not mirrored in leveling.js.

export type LevelTier = { label: string; color: string }

const LEVEL_TIERS: { min: number; label: string; color: string }[] = [
  { min: 50, label: 'Legend', color: 'var(--amber)' },
  { min: 30, label: 'Veteran', color: 'var(--green)' },
  { min: 15, label: 'Established', color: 'var(--cyan)' },
  { min: 5, label: 'Regular', color: 'var(--p-1)' },
  { min: 0, label: 'Newcomer', color: 'var(--text-3)' },
]

export function levelBadge(level: number): LevelTier {
  const tier = LEVEL_TIERS.find((t) => level >= t.min) ?? LEVEL_TIERS[LEVEL_TIERS.length - 1]
  return { label: tier.label, color: tier.color }
}

// ── Settings ────────────────────────────────────────────────────────────────
// The leveling_settings row is { enabled, settings } — enabled is a column, the
// rest is a jsonb blob. normaliseLevelingSettings folds both into one flat
// config and applies defaults, so a MISSING row (null) yields "enabled with
// sensible defaults" (XP tracking is on by default).

export type LevelupAnnounce = 'off' | 'current' | 'channel' | 'dm'

export type LevelReward = {
  /** Level at which the role is granted. */
  level: number
  role_id: string
}

export type LevelingConfig = {
  enabled: boolean
  /** Random XP per qualifying message, picked uniformly in [min, max]. */
  xp_per_message_min: number
  xp_per_message_max: number
  /** Seconds a member must wait between message XP awards (anti-spam). */
  message_cooldown_seconds: number
  /** XP granted per full minute spent in a (non-ignored) voice channel. */
  xp_per_voice_minute: number
  /** XP per slash/bot command used (gated by command_cooldown_seconds). */
  xp_per_command: number
  command_cooldown_seconds: number
  /** One-time XP for entering a giveaway. */
  xp_per_giveaway_entry: number
  /** One-time XP for marking interest in a scheduled event. */
  xp_per_event: number
  /** Global multiplier applied to every award (1 = normal). */
  xp_multiplier: number
  curve: LevelCurve
  /** Channels where messages earn no XP. */
  ignored_channel_ids: string[]
  /** Members holding any of these roles earn no XP. */
  ignored_role_ids: string[]
  /** Where level-up messages go (off until a channel/mode is chosen). */
  levelup_announce: LevelupAnnounce
  levelup_channel_id: string | null
  /** Template; placeholders {user} {mention} {level} {server}. */
  levelup_message: string
  /** Reward roles granted on reaching a level. */
  rewards: LevelReward[]
  /** Keep all earned reward roles (true) vs. only the highest (false). */
  stack_rewards: boolean
}

export const DEFAULT_LEVELUP_MESSAGE = '🎉 GG {mention}, you just reached **level {level}**!'

export const LEVELING_LIMITS = {
  maxXpPerEvent: 100_000,
  maxCooldownSeconds: 86_400,
  maxMultiplier: 100,
  maxRewards: 50,
  maxRewardLevel: MAX_LEVEL,
  maxIgnored: 100,
  maxMessage: 500,
} as const

export function defaultLevelingConfig(): LevelingConfig {
  return {
    enabled: true,
    xp_per_message_min: 15,
    xp_per_message_max: 25,
    message_cooldown_seconds: 60,
    xp_per_voice_minute: 5,
    xp_per_command: 5,
    command_cooldown_seconds: 60,
    xp_per_giveaway_entry: 25,
    xp_per_event: 50,
    xp_multiplier: 1,
    curve: { ...DEFAULT_CURVE },
    ignored_channel_ids: [],
    ignored_role_ids: [],
    levelup_announce: 'off',
    levelup_channel_id: null,
    levelup_message: DEFAULT_LEVELUP_MESSAGE,
    rewards: [],
    stack_rewards: false,
  }
}

type LevelingRow = { enabled?: boolean | null; settings?: unknown } | null | undefined

/** Coerce a leveling_settings row (or null) into a fully-shaped config. */
export function normaliseLevelingSettings(row: LevelingRow): LevelingConfig {
  const base = defaultLevelingConfig()
  if (!row) return base
  const enabled = typeof row.enabled === 'boolean' ? row.enabled : base.enabled
  const s = row.settings && typeof row.settings === 'object' ? (row.settings as Record<string, unknown>) : {}

  const min = clampNum(s.xp_per_message_min, 0, LEVELING_LIMITS.maxXpPerEvent, base.xp_per_message_min)
  const max = clampNum(s.xp_per_message_max, 0, LEVELING_LIMITS.maxXpPerEvent, base.xp_per_message_max)

  return {
    enabled,
    // Guarantee min ≤ max so the random pick is always valid.
    xp_per_message_min: Math.min(min, max),
    xp_per_message_max: Math.max(min, max),
    message_cooldown_seconds: clampNum(s.message_cooldown_seconds, 0, LEVELING_LIMITS.maxCooldownSeconds, base.message_cooldown_seconds),
    xp_per_voice_minute: clampNum(s.xp_per_voice_minute, 0, LEVELING_LIMITS.maxXpPerEvent, base.xp_per_voice_minute),
    xp_per_command: clampNum(s.xp_per_command, 0, LEVELING_LIMITS.maxXpPerEvent, base.xp_per_command),
    command_cooldown_seconds: clampNum(s.command_cooldown_seconds, 0, LEVELING_LIMITS.maxCooldownSeconds, base.command_cooldown_seconds),
    xp_per_giveaway_entry: clampNum(s.xp_per_giveaway_entry, 0, LEVELING_LIMITS.maxXpPerEvent, base.xp_per_giveaway_entry),
    xp_per_event: clampNum(s.xp_per_event, 0, LEVELING_LIMITS.maxXpPerEvent, base.xp_per_event),
    xp_multiplier: clampFloat(s.xp_multiplier, 0, LEVELING_LIMITS.maxMultiplier, base.xp_multiplier),
    curve: normaliseCurve(s.curve),
    ignored_channel_ids: toStringArray(s.ignored_channel_ids).slice(0, LEVELING_LIMITS.maxIgnored),
    ignored_role_ids: toStringArray(s.ignored_role_ids).slice(0, LEVELING_LIMITS.maxIgnored),
    levelup_announce: normaliseAnnounce(s.levelup_announce),
    levelup_channel_id: typeof s.levelup_channel_id === 'string' && s.levelup_channel_id ? s.levelup_channel_id : null,
    levelup_message: typeof s.levelup_message === 'string' && s.levelup_message.trim()
      ? s.levelup_message.slice(0, LEVELING_LIMITS.maxMessage)
      : base.levelup_message,
    rewards: normaliseRewards(s.rewards),
    stack_rewards: Boolean(s.stack_rewards),
  }
}

/** Split a config back into the { enabled, settings } persistence shape. */
export function serialiseLevelingSettings(c: LevelingConfig): { enabled: boolean; settings: Record<string, unknown> } {
  const { enabled, ...settings } = c
  return { enabled, settings }
}

function normaliseAnnounce(v: unknown): LevelupAnnounce {
  return v === 'current' || v === 'channel' || v === 'dm' || v === 'off' ? v : 'off'
}

export function normaliseRewards(raw: unknown): LevelReward[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const out: LevelReward[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    // Clamp from 0 (not 1) so a level-0 / negative reward is dropped by the
    // guard below rather than silently promoted to level 1.
    const level = clampNum(o.level, 0, LEVELING_LIMITS.maxRewardLevel, 0)
    const roleId = typeof o.role_id === 'string' ? o.role_id : ''
    if (level < 1 || !roleId || seen.has(level)) continue
    seen.add(level)
    out.push({ level, role_id: roleId })
  }
  return out.sort((a, b) => a.level - b.level).slice(0, LEVELING_LIMITS.maxRewards)
}

// ── Reward-role resolution ────────────────────────────────────────────────────

/** Every distinct reward role id configured (the full managed set). */
export function allRewardRoleIds(rewards: LevelReward[]): string[] {
  return [...new Set(rewards.map((r) => r.role_id))]
}

/**
 * Reward role ids a member at `level` SHOULD currently hold. When stacking,
 * that's every reward at or below their level; otherwise just the single
 * highest. The bot adds these (idempotently) and removes the rest of
 * allRewardRoleIds — robust even if a level-up was missed while offline.
 */
export function earnedRewardRoleIds(level: number, rewards: LevelReward[], stack: boolean): string[] {
  const eligible = rewards.filter((r) => r.level <= level)
  if (eligible.length === 0) return []
  if (stack) return [...new Set(eligible.map((r) => r.role_id))]
  const highest = eligible.reduce((a, b) => (b.level > a.level ? b : a))
  return [highest.role_id]
}

/** Rewards first earned crossing `oldLevel` → `newLevel` (for the announcement). */
export function newlyEarnedRewards(oldLevel: number, newLevel: number, rewards: LevelReward[]): LevelReward[] {
  return rewards.filter((r) => r.level > oldLevel && r.level <= newLevel)
}

// ── Level-up message templating ────────────────────────────────────────────────

export type LevelupContext = {
  user: string
  mention: string
  level: number | string
  server: string
}

/** Substitute {user} {mention} {level} {server} placeholders. */
export function renderLevelupMessage(template: string, ctx: LevelupContext): string {
  return template
    .replace(/\{user\}/g, ctx.user)
    .replace(/\{mention\}/g, ctx.mention)
    .replace(/\{level\}/g, String(ctx.level))
    .replace(/\{server\}/g, ctx.server)
}

// ── XP source metadata (settings UI + analytics labels) ────────────────────────

export type XpSourceKey = 'message' | 'voice' | 'command' | 'giveaway' | 'event'

export const XP_SOURCES: { key: XpSourceKey; label: string; icon: string }[] = [
  { key: 'message', label: 'Messages', icon: 'MessageSquare' },
  { key: 'voice', label: 'Voice activity', icon: 'Mic' },
  { key: 'command', label: 'Command usage', icon: 'Terminal' },
  { key: 'giveaway', label: 'Giveaway entries', icon: 'Gift' },
  { key: 'event', label: 'Event participation', icon: 'CalendarDays' },
]

// ── Small shared utilities ────────────────────────────────────────────────────

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function clampFloat(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}
