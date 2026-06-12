// Rewards Shop & Marketplace engine (PULSIFY-46).
//
// The shop is the first SINK for the global Pulse Coin economy (lib/economy.ts):
// members spend their GLOBAL balance on rewards. Reward DEFINITIONS live in
// `shop_rewards` (scope 'server' → a guild's own shop; scope 'global' → the
// operator-managed catalogue shown everywhere); each purchase writes a
// `reward_purchases` row that doubles as an inventory item.
//
// This module is the source of truth for reward categories, the per-category
// payload/fulfilment shape, purchase-requirement checks and the pure analytics
// builder. The bot MIRRORS the pure helpers in pulse-bot/src/shop.js — keep the
// two in sync (same as economy.ts ↔ economy.js, leveling.ts ↔ leveling.js).
//
// IMPORTANT: there is no "grant reputation" reward. Reputation is computed on
// the fly and never stored/granted (see lib/economy.ts / 20260613). Reputation
// participates here ONLY as a purchase REQUIREMENT (see meetsRequirements).

import { timeframeSince, timeframeBucket, type Timeframe } from '@/lib/analytics'
import { formatCoins } from '@/lib/economy'

export { formatCoins }

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

// ── Categories ───────────────────────────────────────────────────────────────

// Five clear reward types. Each does ONE understandable thing; the older
// perk/custom/event (all staff-fulfilled) collapsed into `perk`, and
// badge/cosmetic collapsed into `cosmetic` (a `payload.effect` distinguishes a
// passive profile badge from a chrome decoration like the Corner HUD).
export type RewardCategory =
  | 'role'
  | 'xp_booster'
  | 'giveaway_entry'
  | 'perk'
  | 'cosmetic'

export type RewardScope = 'server' | 'global'

// Known cosmetic effects. 'badge' = passive, renders on the Pulse profile;
// 'corner_hud' = unlocks the animated corner-decoration toggle in Preferences.
export const COSMETIC_EFFECT = { BADGE: 'badge', CORNER_HUD: 'corner_hud' } as const
export type CosmeticEffect = (typeof COSMETIC_EFFECT)[keyof typeof COSMETIC_EFFECT]

// Legacy category values that may still sit in dev rows / purchase snapshots
// from before the consolidation — mapped on read so they keep rendering.
const LEGACY_CATEGORY: Record<string, RewardCategory> = {
  custom: 'perk',
  event: 'perk',
  badge: 'cosmetic',
}

// How a purchased reward is fulfilled:
//   'auto'   — the web app fulfils on purchase (e.g. grants a Discord role).
//   'bot'    — the bot fulfils/maintains it (boosters, giveaway entries).
//   'manual' — staff fulfil it; the buyer redeems and the reward is logged.
//   'cosmetic' — nothing to fulfil; ownership alone renders it (badges).
export type RewardFulfilment = 'auto' | 'bot' | 'manual' | 'cosmetic'

export type CategoryMeta = {
  label: string
  /** lucide-react icon name; the UI maps this to a component. */
  icon: string
  /** Short tagline for the category header. */
  description: string
  /** Plain-language "what actually happens" — shown in the editor + shop card so
   *  members and admins understand the reward without guessing. */
  howItWorks: string
  /** Which scope(s) may use this category. */
  scopes: RewardScope[]
  fulfilment: RewardFulfilment
  /** Whether the reward can expire (drives the temporary-duration controls). */
  temporary: boolean
}

export const CATEGORY_META: Record<RewardCategory, CategoryMeta> = {
  role: {
    label: 'Discord role',
    icon: 'Shield',
    description: 'Grants a Discord role.',
    howItWorks:
      'The member gets the role the instant they buy it. Add a duration to make it temporary — Pulse removes it automatically when it expires.',
    scopes: ['server'],
    fulfilment: 'auto',
    temporary: true,
  },
  xp_booster: {
    label: 'XP booster',
    icon: 'Zap',
    description: 'Multiplies the XP the member earns here.',
    howItWorks:
      'The member activates it from their Inventory, then earns multiplied XP in this server until the booster runs out.',
    scopes: ['server'],
    fulfilment: 'bot',
    temporary: true,
  },
  giveaway_entry: {
    label: 'Giveaway entries',
    icon: 'Ticket',
    description: 'Boosts the member’s odds in giveaways.',
    howItWorks:
      'Applied automatically the next time the member joins a giveaway in this server — extra weighted entries make them more likely to win.',
    scopes: ['server'],
    fulfilment: 'bot',
    temporary: false,
  },
  perk: {
    label: 'Custom perk',
    icon: 'Gift',
    description: 'Anything your staff fulfil by hand.',
    howItWorks:
      'The member redeems it from their Inventory; your staff are notified to fulfil it. Use the instructions field to tell staff exactly what to do (special access, a shout-out, a custom request…).',
    scopes: ['server'],
    fulfilment: 'manual',
    temporary: false,
  },
  cosmetic: {
    label: 'Profile cosmetic',
    icon: 'Palette',
    description: 'Decorates the member’s global Pulse identity.',
    howItWorks:
      'Owning it is all it takes — badges show on the member’s Pulse profile across every server. Special decorations (like the Animated Corner HUD) unlock a toggle in Preferences.',
    scopes: ['global', 'server'],
    fulfilment: 'cosmetic',
    temporary: false,
  },
}

export const REWARD_CATEGORIES = Object.keys(CATEGORY_META) as RewardCategory[]

export function isRewardCategory(v: unknown): v is RewardCategory {
  return typeof v === 'string' && v in CATEGORY_META
}

/** Coerce any stored/legacy category value to a current one (defaults to perk). */
export function coerceCategory(v: unknown): RewardCategory {
  if (isRewardCategory(v)) return v
  if (typeof v === 'string' && v in LEGACY_CATEGORY) return LEGACY_CATEGORY[v]
  return 'perk'
}

// ── Limits (shared by API + UI validation) ───────────────────────────────────

export const REWARD_LIMITS = {
  maxName: 80,
  maxDescription: 300,
  maxCost: 10_000_000,
  maxStock: 1_000_000,
  maxPerUser: 1000,
  maxBoosterMultiplier: 5,
  maxBoosterHours: 720, // 30 days
  maxRoleDurationDays: 365,
  maxGiveawayEntries: 100,
  maxRewardsPerGuild: 200,
} as const

// ── Records ──────────────────────────────────────────────────────────────────

export type PurchaseStatus = 'active' | 'consumed' | 'expired' | 'refunded'
export type PurchaseFulfilment = 'fulfilled' | 'pending' | 'failed' | 'manual'

export type RewardRequirements = {
  min_reputation?: number
  min_level?: number
  achievement_ids?: string[]
}

export type ShopReward = {
  id: string
  scope: RewardScope
  guild_id: string | null
  category: RewardCategory
  name: string
  description: string | null
  cost: number
  /** null = unlimited stock. */
  stock: number | null
  stock_remaining: number | null
  per_user_limit: number | null
  active: boolean
  featured: boolean
  sort: number
  icon: string | null
  color: string | null
  image_url: string | null
  payload: Record<string, unknown>
  requirements: RewardRequirements
  created_by: string | null
  created_at: string
  updated_at: string
}

export type RewardPurchase = {
  id: string
  reward_id: string | null
  reward_snapshot: Record<string, unknown>
  user_id: string
  user_name: string | null
  guild_id: string | null
  cost: number
  transaction_id: number | null
  status: PurchaseStatus
  fulfillment: PurchaseFulfilment
  activated_at: string | null
  expires_at: string | null
  created_at: string
  /** Cosmetics only: member's display toggle (Inventory). Default true. */
  enabled: boolean
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function normaliseRequirements(v: unknown): RewardRequirements {
  const o = asObject(v)
  const out: RewardRequirements = {}
  if (numOrNull(o.min_reputation) != null) out.min_reputation = Math.max(0, Math.min(100, num(o.min_reputation)))
  if (numOrNull(o.min_level) != null) out.min_level = Math.max(0, num(o.min_level))
  if (Array.isArray(o.achievement_ids)) {
    const ids = o.achievement_ids.filter((x): x is string => typeof x === 'string' && !!x)
    if (ids.length) out.achievement_ids = ids
  }
  return out
}

export function normaliseReward(row: Record<string, unknown>): ShopReward {
  const category = coerceCategory(row.category)
  const scope: RewardScope = row.scope === 'global' ? 'global' : 'server'
  return {
    id: String(row.id ?? ''),
    scope,
    guild_id: scope === 'global' ? null : (row.guild_id ? String(row.guild_id) : null),
    category,
    name: String(row.name ?? '').slice(0, REWARD_LIMITS.maxName) || 'Reward',
    description: row.description ? String(row.description).slice(0, REWARD_LIMITS.maxDescription) : null,
    cost: Math.max(0, Math.min(REWARD_LIMITS.maxCost, num(row.cost))),
    stock: numOrNull(row.stock),
    stock_remaining: numOrNull(row.stock_remaining),
    per_user_limit: numOrNull(row.per_user_limit),
    active: row.active !== false,
    featured: row.featured === true,
    sort: num(row.sort),
    icon: row.icon ? String(row.icon) : null,
    color: row.color ? String(row.color) : null,
    image_url: row.image_url ? String(row.image_url) : null,
    payload: asObject(row.payload),
    requirements: normaliseRequirements(row.requirements),
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

export function normalisePurchase(row: Record<string, unknown>): RewardPurchase {
  const status = ['active', 'consumed', 'expired', 'refunded'].includes(String(row.status))
    ? (row.status as PurchaseStatus)
    : 'active'
  const fulfillment = ['fulfilled', 'pending', 'failed', 'manual'].includes(String(row.fulfillment))
    ? (row.fulfillment as PurchaseFulfilment)
    : 'pending'
  return {
    id: String(row.id ?? ''),
    reward_id: row.reward_id ? String(row.reward_id) : null,
    reward_snapshot: asObject(row.reward_snapshot),
    user_id: String(row.user_id ?? ''),
    user_name: row.user_name ? String(row.user_name) : null,
    guild_id: row.guild_id ? String(row.guild_id) : null,
    cost: num(row.cost),
    transaction_id: numOrNull(row.transaction_id),
    status,
    fulfillment,
    activated_at: row.activated_at ? String(row.activated_at) : null,
    expires_at: row.expires_at ? String(row.expires_at) : null,
    created_at: String(row.created_at ?? ''),
    enabled: row.enabled !== false,
  }
}

// ── Typed payload accessors ──────────────────────────────────────────────────

export function rolePayload(r: ShopReward): { roleId: string | null; durationDays: number | null } {
  return {
    roleId: r.payload.role_id ? String(r.payload.role_id) : null,
    durationDays: numOrNull(r.payload.duration_days),
  }
}

export function boosterPayload(r: ShopReward): { multiplier: number; durationHours: number } {
  return {
    multiplier: Math.max(1, Math.min(REWARD_LIMITS.maxBoosterMultiplier, num(r.payload.multiplier) || 2)),
    durationHours: Math.max(1, Math.min(REWARD_LIMITS.maxBoosterHours, num(r.payload.duration_hours) || 24)),
  }
}

export function giveawayEntryPayload(r: ShopReward): { entries: number } {
  return { entries: Math.max(1, Math.min(REWARD_LIMITS.maxGiveawayEntries, num(r.payload.entries) || 1)) }
}

/**
 * Whether a reward needs the buyer to explicitly redeem/activate it after
 * purchase (manual perks, boosters) vs. being fulfilled immediately (roles,
 * cosmetics, giveaway-entry grants).
 */
export function needsActivation(category: RewardCategory): boolean {
  return category === 'xp_booster' || CATEGORY_META[category].fulfilment === 'manual'
}

/**
 * Expiry timestamp (ISO) to stamp on a purchase, or null for non-expiring
 * rewards. Roles expire from purchase time; boosters expire from ACTIVATION, so
 * pass `from` = activation time for those.
 */
export function computeExpiry(reward: ShopReward, from: Date = new Date()): string | null {
  if (reward.category === 'role') {
    const { durationDays } = rolePayload(reward)
    if (!durationDays) return null
    return new Date(from.getTime() + durationDays * DAY_MS).toISOString()
  }
  if (reward.category === 'xp_booster') {
    const { durationHours } = boosterPayload(reward)
    return new Date(from.getTime() + durationHours * HOUR_MS).toISOString()
  }
  return null
}

// ── Purchase requirements ────────────────────────────────────────────────────

export type RequirementContext = {
  reputation: number
  level: number
  balance: number
  achievementIds: string[]
}

export type RequirementResult = { ok: boolean; reasons: string[] }

/**
 * Evaluate a reward's purchase gates against a member. Balance is checked here
 * for UI affordances but is also enforced atomically by economy_purchase().
 */
export function meetsRequirements(reward: ShopReward, ctx: RequirementContext): RequirementResult {
  const reasons: string[] = []
  const req = reward.requirements
  if (req.min_reputation != null && ctx.reputation < req.min_reputation) {
    reasons.push(`Requires ${req.min_reputation}+ reputation (you have ${ctx.reputation}).`)
  }
  if (req.min_level != null && ctx.level < req.min_level) {
    reasons.push(`Requires level ${req.min_level}+ in this server (you're level ${ctx.level}).`)
  }
  if (req.achievement_ids?.length) {
    const owned = new Set(ctx.achievementIds)
    const missing = req.achievement_ids.filter((id) => !owned.has(id))
    if (missing.length) {
      reasons.push(`Requires ${missing.length} more achievement${missing.length === 1 ? '' : 's'}.`)
    }
  }
  if (ctx.balance < reward.cost) {
    reasons.push(`Costs ${formatCoins(reward.cost)} coins (you have ${formatCoins(ctx.balance)}).`)
  }
  return { ok: reasons.length === 0, reasons }
}

export function hasRequirements(reward: ShopReward): boolean {
  const r = reward.requirements
  return r.min_reputation != null || r.min_level != null || !!r.achievement_ids?.length
}

export function inStock(reward: ShopReward): boolean {
  return reward.stock_remaining == null || reward.stock_remaining > 0
}

// ── Owned cosmetics (derived from purchases — decorate the Pulse profile) ────

export type OwnedCosmetic = {
  /** The owning purchase id. */
  id: string
  category: 'cosmetic'
  name: string
  description: string | null
  icon: string | null
  color: string | null
  image_url: string | null
  /** 'badge' | 'corner_hud' — what the cosmetic does. */
  effect: string
}

/** True if a purchase snapshot is a cosmetic (current 'cosmetic' or legacy 'badge'). */
function isCosmeticSnapshot(snap: Record<string, unknown>): boolean {
  return snap.category === 'cosmetic' || snap.category === 'badge'
}

function cosmeticEffectOf(snap: Record<string, unknown>): string {
  const payload = (snap.payload ?? {}) as Record<string, unknown>
  return typeof payload.effect === 'string' ? payload.effect : COSMETIC_EFFECT.BADGE
}

/**
 * The cosmetic items a member OWNS, from their active purchases — the category
 * whose value is "ownership renders it" (CATEGORY_META fulfilment === 'cosmetic').
 * Passive badges decorate the global Pulse profile; functional effects (Corner
 * HUD) drive unlock checks (see cosmeticEffects). Deduped by name; newest kept.
 */
export function ownedCosmetics(purchases: RewardPurchase[]): OwnedCosmetic[] {
  const out: OwnedCosmetic[] = []
  const seen = new Set<string>()
  for (const p of purchases) {
    if (p.status !== 'active' || !p.enabled) continue
    const snap = p.reward_snapshot
    if (!isCosmeticSnapshot(snap)) continue
    const name = String(snap.name ?? 'Cosmetic')
    const dedupe = name.toLowerCase()
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    out.push({
      id: p.id,
      category: 'cosmetic',
      name,
      description: snap.description ? String(snap.description) : null,
      icon: snap.icon ? String(snap.icon) : null,
      color: typeof snap.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(String(snap.color)) ? String(snap.color) : null,
      image_url: snap.image_url ? String(snap.image_url) : null,
      effect: cosmeticEffectOf(snap),
    })
  }
  return out
}

/**
 * The distinct cosmetic EFFECTS a member owns (e.g. ['corner_hud']). Drives
 * unlock gating for functional cosmetics like the Corner HUD decoration.
 */
export function cosmeticEffects(purchases: RewardPurchase[]): string[] {
  const set = new Set<string>()
  for (const p of purchases) {
    if (p.status !== 'active' || !p.enabled) continue
    if (!isCosmeticSnapshot(p.reward_snapshot)) continue
    set.add(cosmeticEffectOf(p.reward_snapshot))
  }
  return [...set]
}

// ── Write validation (shared by the create + edit API routes) ───────────────

function clampInt(v: unknown, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(num(v))))
}

/** Sanitise a category's type-specific payload to just its known fields. */
export function sanitizePayload(category: RewardCategory, raw: unknown): Record<string, unknown> {
  const o = asObject(raw)
  switch (category) {
    case 'role':
      return {
        role_id: o.role_id ? String(o.role_id) : null,
        duration_days: numOrNull(o.duration_days)
          ? clampInt(o.duration_days, 1, REWARD_LIMITS.maxRoleDurationDays)
          : null,
      }
    case 'xp_booster':
      return {
        multiplier: clampInt(o.multiplier ?? 2, 1, REWARD_LIMITS.maxBoosterMultiplier),
        duration_hours: clampInt(o.duration_hours ?? 24, 1, REWARD_LIMITS.maxBoosterHours),
      }
    case 'giveaway_entry':
      return { entries: clampInt(o.entries ?? 1, 1, REWARD_LIMITS.maxGiveawayEntries) }
    case 'cosmetic':
      return {
        cosmetic_key: o.cosmetic_key ? String(o.cosmetic_key).slice(0, 60) : null,
        // Only the two known effects are accepted; anything else is a passive badge.
        effect: o.effect === COSMETIC_EFFECT.CORNER_HUD ? COSMETIC_EFFECT.CORNER_HUD : COSMETIC_EFFECT.BADGE,
      }
    case 'perk':
      return {
        instructions: o.instructions ? String(o.instructions).slice(0, REWARD_LIMITS.maxDescription) : null,
        channel_id: o.channel_id ? String(o.channel_id) : null,
      }
    default:
      return {}
  }
}

export type RewardWrite = {
  scope: RewardScope
  category: RewardCategory
  name: string
  description: string | null
  cost: number
  stock: number | null
  per_user_limit: number | null
  active: boolean
  featured: boolean
  sort: number
  icon: string | null
  color: string | null
  image_url: string | null
  payload: Record<string, unknown>
  requirements: RewardRequirements
}

export type RewardWriteResult = { ok: true; value: RewardWrite } | { ok: false; error: string }

/**
 * Validate and normalise a reward create/edit body into a DB-ready write.
 * Caller decides scope authorisation (server → admin, global → operator).
 */
export function sanitizeRewardInput(body: unknown, scope: RewardScope): RewardWriteResult {
  const b = asObject(body)
  if (!isRewardCategory(b.category)) return { ok: false, error: 'Pick a valid reward category.' }
  const category = b.category
  if (!CATEGORY_META[category].scopes.includes(scope)) {
    return { ok: false, error: `${CATEGORY_META[category].label} isn't available for ${scope} rewards.` }
  }
  const name = String(b.name ?? '').trim().slice(0, REWARD_LIMITS.maxName)
  if (!name) return { ok: false, error: 'A reward name is required.' }
  const cost = clampInt(b.cost, 0, REWARD_LIMITS.maxCost)

  const payload = sanitizePayload(category, b.payload)
  if (category === 'role' && !payload.role_id) {
    return { ok: false, error: 'Pick a Discord role for this reward.' }
  }
  // The functional Corner-HUD effect is operator/global-only; server cosmetics
  // are always passive profile badges.
  if (category === 'cosmetic' && scope === 'server') payload.effect = COSMETIC_EFFECT.BADGE

  return {
    ok: true,
    value: {
      scope,
      category,
      name,
      description: b.description ? String(b.description).trim().slice(0, REWARD_LIMITS.maxDescription) || null : null,
      cost,
      stock: numOrNull(b.stock) != null ? clampInt(b.stock, 0, REWARD_LIMITS.maxStock) : null,
      per_user_limit: numOrNull(b.per_user_limit) != null ? clampInt(b.per_user_limit, 1, REWARD_LIMITS.maxPerUser) : null,
      active: b.active !== false,
      featured: b.featured === true,
      sort: clampInt(b.sort ?? 0, 0, 1_000_000),
      icon: b.icon ? String(b.icon).slice(0, 40) : null,
      color: typeof b.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : null,
      image_url: b.image_url ? String(b.image_url).slice(0, 500) : null,
      payload,
      requirements: normaliseRequirements(b.requirements),
    },
  }
}

// ── Analytics (pure — fed by the shop-analytics API route) ───────────────────

export type ShopTrendPoint = { bucket: string; purchases: number; coins: number }

export type ShopAnalytics = {
  totalPurchases: number
  coinsSpent: number
  activeRewards: number
  uniqueBuyers: number
  refundedCount: number
  /** Most-purchased rewards (by snapshot name), within the window. */
  topRewards: { reward_id: string | null; name: string; count: number; coins: number }[]
  trend: ShopTrendPoint[]
}

/**
 * Aggregate a window of purchase rows into the shop Overview analytics. Mirrors
 * buildEconomyAnalytics: hourly buckets for 24h, daily otherwise, zero-filled so
 * the chart axis is continuous ('all' just sorts the buckets that exist).
 */
export function buildShopAnalytics(
  purchases: RewardPurchase[],
  activeRewards: number,
  timeframe: Timeframe,
): ShopAnalytics {
  let coinsSpent = 0
  let refundedCount = 0
  const buyers = new Set<string>()

  const stepMs = timeframeBucket(timeframe) === 'hour' ? HOUR_MS : DAY_MS
  const bucketStart = (iso: string) => Math.floor(new Date(iso).getTime() / stepMs) * stepMs
  const byBucket = new Map<number, ShopTrendPoint>()
  const trendBucket = (iso: string) => {
    const key = bucketStart(iso)
    let p = byBucket.get(key)
    if (!p) {
      p = { bucket: new Date(key).toISOString(), purchases: 0, coins: 0 }
      byBucket.set(key, p)
    }
    return p
  }

  const byReward = new Map<string, { reward_id: string | null; name: string; count: number; coins: number }>()

  for (const p of purchases) {
    if (p.status === 'refunded') {
      refundedCount++
      continue
    }
    buyers.add(p.user_id)
    coinsSpent += p.cost
    const b = trendBucket(p.created_at)
    b.purchases++
    b.coins += p.cost
    const name = String(p.reward_snapshot.name ?? 'Reward')
    const key = p.reward_id ?? `name:${name}`
    const e = byReward.get(key) ?? { reward_id: p.reward_id, name, count: 0, coins: 0 }
    e.count++
    e.coins += p.cost
    byReward.set(key, e)
  }

  let trend: ShopTrendPoint[]
  if (timeframe === 'all') {
    trend = [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)
  } else {
    const start = Math.floor(new Date(timeframeSince(timeframe)!).getTime() / stepMs) * stepMs
    const now = Date.now()
    trend = []
    for (let t = start; t <= now; t += stepMs) {
      trend.push(byBucket.get(t) ?? { bucket: new Date(t).toISOString(), purchases: 0, coins: 0 })
    }
  }

  const topRewards = [...byReward.values()].sort((a, b) => b.count - a.count).slice(0, 5)

  return {
    totalPurchases: purchases.filter((p) => p.status !== 'refunded').length,
    coinsSpent,
    activeRewards,
    uniqueBuyers: buyers.size,
    refundedCount,
    topRewards,
    trend,
  }
}
