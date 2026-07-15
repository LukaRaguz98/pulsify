// Invite Tracking & Referral System — pure model + helpers (PULSIFY-60).
//
// Tracks which invite a member used to join, scores each inviter's performance
// (valid vs fake vs left), and rewards members for successful referrals. This
// module holds all the pure logic used on BOTH sides: the dashboard renders /
// sorts / validates from these types, and the bot mirrors the settings math +
// validity evaluation in pulse-bot/src/invites.js — keep the two in sync the
// same way lib/birthdays.ts ↔ birthdays.js are.
//
// No JSX / framework / IO imports live here (icons are lucide NAMES resolved in
// the UI layer), so this is safe to import into client components.
//
// NOTE — reward types. The spec lists "Global Reputation" as a reward, but
// Pulsify's reputation is a COMPUTED 0-100 signal, never a granted points
// balance (same stance as the Birthday system, confirmed by the user). It is
// deliberately NOT a reward type here. "Marketplace items" map to `shop_item`
// and "achievements / badges" map to `custom` named recognitions.

// ── Row shapes ─────────────────────────────────────────────────────────────────

export type Invite = {
  id: string
  guild_id: string
  code: string
  inviter_id: string | null
  inviter_name: string | null
  channel_id: string | null
  uses: number
  max_uses: number
  max_age: number
  temporary: boolean
  is_vanity: boolean
  created_at: string | null
  last_seen_at: string
  deleted_at: string | null
}

export type InviteStatus = 'pending' | 'valid' | 'invalid' | 'fake' | 'left'
export type InviteSource = 'normal' | 'vanity' | 'oauth' | 'bot' | 'unknown'

export type InvitedMember = {
  id: string
  guild_id: string
  user_id: string
  user_name: string | null
  inviter_id: string | null
  inviter_name: string | null
  invite_code: string | null
  source: InviteSource
  account_created_at: string | null
  joined_at: string
  left_at: string | null
  status: InviteStatus
  fake_reason: string | null
  is_alt: boolean
  completed_onboarding: boolean
  verified: boolean
  is_active: boolean
  rejoin_count: number
  is_bonus: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type InviteRewardClaim = {
  id: string
  guild_id: string
  reward_id: string
  user_id: string
  user_name: string | null
  threshold: number
  valid_count: number
  rewards: InviteRewardItem[]
  revoked_at: string | null
  created_at: string
}

export type InviteAdjustmentKind = 'bonus' | 'invalidate' | 'approve' | 'grant_reward' | 'reset'

export type InviteAdjustment = {
  id: string
  guild_id: string
  user_id: string | null
  user_name: string | null
  kind: InviteAdjustmentKind
  amount: number
  target_user_id: string | null
  target_name: string | null
  reason: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
}

// ── Status + source display ──────────────────────────────────────────────────

export const STATUS_META: Record<InviteStatus, { label: string; tone: 'good' | 'bad' | 'warn' | 'muted'; hint: string }> = {
  valid: { label: 'Valid', tone: 'good', hint: 'Counts toward the inviter and rewards.' },
  pending: { label: 'Pending', tone: 'warn', hint: 'Waiting to meet the valid-invite rules.' },
  invalid: { label: 'Invalid', tone: 'muted', hint: 'A rule failed — does not count.' },
  fake: { label: 'Fake', tone: 'bad', hint: 'Anti-abuse tripped — does not count.' },
  left: { label: 'Left', tone: 'muted', hint: 'The member left the server.' },
}

export function statusLabel(s: InviteStatus): string {
  return STATUS_META[s]?.label ?? s
}

export const SOURCE_META: Record<InviteSource, string> = {
  normal: 'Invite link',
  vanity: 'Vanity URL',
  oauth: 'OAuth / bot add',
  bot: 'Bot',
  unknown: 'Unknown',
}

/** Human reasons for a fake / invalid / pending status. */
export const REASON_LABELS: Record<string, string> = {
  self_invite: 'Self-invite',
  alt_account: 'Alt account farming',
  rejoin_abuse: 'Rapid rejoin abuse',
  account_too_young: 'Account too new',
  likely_alt: 'Likely alt account',
  moderation_flags: 'Active moderation flags',
  awaiting_stay: 'Waiting on minimum stay',
  awaiting_onboarding: 'Onboarding not completed',
  awaiting_verification: 'Not verified yet',
  awaiting_activity: 'Not active enough yet',
  admin_invalidated: 'Invalidated by an admin',
  admin_approved: 'Approved by an admin',
}

export function reasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null
  return REASON_LABELS[reason] ?? reason
}

// ── Typed rewards ──────────────────────────────────────────────────────────────

export type InviteRewardType = 'coins' | 'xp' | 'role' | 'temp_role' | 'shop_item' | 'custom'

export type InviteRewardItem =
  | { type: 'coins'; amount: number }
  | { type: 'xp'; amount: number }
  | { type: 'role'; role_id: string }
  | { type: 'temp_role'; role_id: string; duration_hours: number }
  | { type: 'shop_item'; item_id: string; item_name: string | null }
  | { type: 'custom'; label: string }

export const REWARD_TYPE_META: Record<InviteRewardType, { label: string; icon: string; hint: string }> = {
  coins: { label: 'Pulse Coins', icon: 'Coins', hint: 'Global balance added to the inviter.' },
  xp: { label: 'Server XP', icon: 'Sparkles', hint: 'XP awarded (level-ups still fire).' },
  role: { label: 'Role', icon: 'Users', hint: 'A permanent Discord role.' },
  temp_role: { label: 'Temporary role', icon: 'Clock', hint: 'A role that auto-expires.' },
  shop_item: { label: 'Marketplace item', icon: 'ShoppingBag', hint: 'A shop item granted to their inventory.' },
  custom: { label: 'Custom / badge', icon: 'Award', hint: 'A named recognition you hand out manually.' },
}

export const REWARD_LIMITS = {
  maxName: 80,
  maxRewards: 12,
  maxCoins: 1_000_000,
  maxXp: 1_000_000,
  maxTempRoleHours: 24 * 90,
  maxCustomLabel: 80,
  maxThreshold: 100_000,
  maxMilestones: 100,
} as const

export function isRewardType(v: unknown): v is InviteRewardType {
  return v === 'coins' || v === 'xp' || v === 'role' || v === 'temp_role' || v === 'shop_item' || v === 'custom'
}

/** Coerce one raw reward item into a valid shape, or null if unusable. */
export function normaliseRewardItem(raw: unknown): InviteRewardItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isRewardType(r.type)) return null
  switch (r.type) {
    case 'coins':
      return { type: 'coins', amount: clampInt(r.amount, 1, REWARD_LIMITS.maxCoins, 0) || 0 }
    case 'xp':
      return { type: 'xp', amount: clampInt(r.amount, 1, REWARD_LIMITS.maxXp, 0) || 0 }
    case 'role':
      return typeof r.role_id === 'string' && r.role_id ? { type: 'role', role_id: r.role_id } : null
    case 'temp_role':
      return typeof r.role_id === 'string' && r.role_id
        ? { type: 'temp_role', role_id: r.role_id, duration_hours: clampInt(r.duration_hours, 1, REWARD_LIMITS.maxTempRoleHours, 24) }
        : null
    case 'shop_item':
      return typeof r.item_id === 'string' && r.item_id
        ? { type: 'shop_item', item_id: r.item_id, item_name: typeof r.item_name === 'string' ? r.item_name : null }
        : null
    case 'custom':
      return typeof r.label === 'string' && r.label.trim()
        ? { type: 'custom', label: r.label.trim().slice(0, REWARD_LIMITS.maxCustomLabel) }
        : null
    default:
      return null
  }
}

export function normaliseRewards(raw: unknown): InviteRewardItem[] {
  if (!Array.isArray(raw)) return []
  const out: InviteRewardItem[] = []
  for (const r of raw) {
    const item = normaliseRewardItem(r)
    if (item) out.push(item)
    if (out.length >= REWARD_LIMITS.maxRewards) break
  }
  return out
}

/** A one-line human summary of a reward item, e.g. "250 Pulse Coins". */
export function summariseReward(item: InviteRewardItem, roleName?: (id: string) => string | undefined): string {
  switch (item.type) {
    case 'coins':
      return `${item.amount.toLocaleString()} Pulse Coins`
    case 'xp':
      return `${item.amount.toLocaleString()} XP`
    case 'role':
      return roleName?.(item.role_id) ? `${roleName(item.role_id)} role` : 'Role'
    case 'temp_role': {
      const name = roleName?.(item.role_id)
      return `${name ? `${name} role` : 'Temporary role'} for ${formatHours(item.duration_hours)}`
    }
    case 'shop_item':
      return item.item_name ? `${item.item_name} (shop)` : 'Marketplace item'
    case 'custom':
      return item.label
    default:
      return 'Reward'
  }
}

function formatHours(hours: number): string {
  if (hours < 24) return `${hours}h`
  const d = Math.floor(hours / 24)
  const h = hours % 24
  return h ? `${d}d ${h}h` : `${d}d`
}

// ── Reward milestone definition ─────────────────────────────────────────────────

export type InviteReward = {
  id: string
  guild_id: string
  name: string
  threshold: number
  enabled: boolean
  icon: string
  rewards: InviteRewardItem[]
  created_by: string | null
  created_at: string
  updated_at: string
}

export type InviteRewardDraft = {
  name: string
  threshold: number
  enabled: boolean
  icon: string
  rewards: InviteRewardItem[]
}

type InviteRewardRow = {
  id?: string
  guild_id?: string
  name?: string | null
  threshold?: number | string | null
  enabled?: boolean | null
  icon?: string | null
  rewards?: unknown
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export function normaliseInviteReward(row: InviteRewardRow): InviteReward {
  return {
    id: String(row.id ?? ''),
    guild_id: String(row.guild_id ?? ''),
    name: String(row.name ?? '').slice(0, REWARD_LIMITS.maxName) || 'Reward',
    threshold: clampInt(row.threshold, 1, REWARD_LIMITS.maxThreshold, 1),
    enabled: row.enabled !== false,
    icon: typeof row.icon === 'string' && row.icon ? row.icon : 'Gift',
    rewards: normaliseRewards(row.rewards),
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

export function validateInviteRewardDraft(draft: InviteRewardDraft): string | null {
  if (!draft.name.trim()) return 'Give your reward a name.'
  if (!Number.isFinite(draft.threshold) || draft.threshold < 1) return 'The threshold must be at least 1 valid invite.'
  if (draft.threshold > REWARD_LIMITS.maxThreshold) return 'That threshold is too large.'
  const rewards = normaliseRewards(draft.rewards)
  if (rewards.length === 0) return 'Add at least one reward to grant.'
  return null
}

export function inviteRewardDraftToRow(draft: InviteRewardDraft): {
  name: string
  threshold: number
  enabled: boolean
  icon: string
  rewards: InviteRewardItem[]
} {
  return {
    name: draft.name.trim().slice(0, REWARD_LIMITS.maxName),
    threshold: clampInt(draft.threshold, 1, REWARD_LIMITS.maxThreshold, 1),
    enabled: draft.enabled !== false,
    icon: draft.icon || 'Gift',
    rewards: normaliseRewards(draft.rewards),
  }
}

export type InviteRewardProgress = { value: number; threshold: number; pct: number; met: boolean; remaining: number }

export function inviteRewardProgress(validCount: number, threshold: number): InviteRewardProgress {
  const v = Math.max(0, validCount)
  const t = Math.max(1, threshold)
  return { value: v, threshold: t, pct: Math.max(0, Math.min(100, Math.round((v / t) * 100))), met: v >= t, remaining: Math.max(0, t - v) }
}

// ── Reward presets (editor quick-fill) ──────────────────────────────────────────

export type InviteRewardPreset = { name: string; threshold: number; icon: string; rewards: InviteRewardItem[] }

export const INVITE_REWARD_PRESETS: InviteRewardPreset[] = [
  { name: 'First 5 Invites', threshold: 5, icon: 'Gift', rewards: [{ type: 'coins', amount: 250 }] },
  { name: 'VIP Recruiter', threshold: 10, icon: 'Crown', rewards: [{ type: 'custom', label: 'VIP role' }] },
  { name: 'Community Builder', threshold: 25, icon: 'Sparkles', rewards: [{ type: 'xp', amount: 500 }] },
  { name: 'Special Badge', threshold: 50, icon: 'Award', rewards: [{ type: 'custom', label: 'Special Badge' }] },
]

// ── Settings (validity rules + anti-abuse + notifications) ──────────────────────

export type InviteConfig = {
  enabled: boolean
  // ── Valid-invite rules ──
  /** Minimum Discord account age in days (0 = off). */
  min_account_age_days: number
  /** Minimum time the member must remain, in hours (0 = off). */
  min_stay_hours: number
  require_onboarding: boolean
  require_verification: boolean
  /** Member must have no active moderation flags. */
  require_no_flags: boolean
  /** Minimum messages the member must have sent (0 = off). */
  min_activity_messages: number
  /** Don't count members flagged as likely alts by Alt Detection. */
  exclude_alts: boolean
  // ── Anti-abuse ──
  block_self_invites: boolean
  block_alt_farming: boolean
  /** Rejoins within this window count toward the rejoin-abuse limit (hours). */
  rejoin_window_hours: number
  /** Rejoins before a join is marked fake (0 = off). */
  max_rejoins: number
  /** Joins/hour from one inviter above this raise a suspicious-spike alert (0 = off). */
  spike_threshold: number
  /** Prevent the same reward being granted more than once. */
  dedup_rewards: boolean
  // ── Reward behaviour ──
  /** Grant every milestone reached (vs the single highest). */
  rewards_stack: boolean
  /** Revoke rewards if the inviter's valid count later drops below the threshold. */
  remove_on_drop: boolean
  // ── Notifications ──
  notify_channel_id: string | null
  notify_on_join: boolean
  notify_on_valid: boolean
  notify_on_milestone: boolean
  notify_on_reward: boolean
  notify_on_invalid: boolean
}

export const INVITE_LIMITS = {
  maxAccountAgeDays: 3650,
  maxStayHours: 24 * 90,
  maxActivityMessages: 100_000,
  maxRejoinWindowHours: 24 * 30,
  maxRejoins: 50,
  maxSpike: 1000,
} as const

export function defaultInviteConfig(): InviteConfig {
  return {
    enabled: false,
    min_account_age_days: 7,
    min_stay_hours: 0,
    require_onboarding: false,
    require_verification: false,
    require_no_flags: true,
    min_activity_messages: 0,
    exclude_alts: true,
    block_self_invites: true,
    block_alt_farming: true,
    rejoin_window_hours: 24,
    max_rejoins: 3,
    spike_threshold: 20,
    dedup_rewards: true,
    rewards_stack: true,
    remove_on_drop: false,
    notify_channel_id: null,
    notify_on_join: false,
    notify_on_valid: false,
    notify_on_milestone: true,
    notify_on_reward: true,
    notify_on_invalid: false,
  }
}

type InviteSettingsRow = { enabled?: boolean | null; settings?: unknown } | null | undefined

export function normaliseInviteSettings(row: InviteSettingsRow): InviteConfig {
  const base = defaultInviteConfig()
  if (!row) return base
  const enabled = typeof row.enabled === 'boolean' ? row.enabled : base.enabled
  const s = row.settings && typeof row.settings === 'object' ? (row.settings as Record<string, unknown>) : {}
  const bool = (v: unknown, d: boolean) => (v == null ? d : Boolean(v))
  return {
    enabled,
    min_account_age_days: clampInt(s.min_account_age_days, 0, INVITE_LIMITS.maxAccountAgeDays, base.min_account_age_days),
    min_stay_hours: clampInt(s.min_stay_hours, 0, INVITE_LIMITS.maxStayHours, base.min_stay_hours),
    require_onboarding: bool(s.require_onboarding, base.require_onboarding),
    require_verification: bool(s.require_verification, base.require_verification),
    require_no_flags: bool(s.require_no_flags, base.require_no_flags),
    min_activity_messages: clampInt(s.min_activity_messages, 0, INVITE_LIMITS.maxActivityMessages, base.min_activity_messages),
    exclude_alts: bool(s.exclude_alts, base.exclude_alts),
    block_self_invites: bool(s.block_self_invites, base.block_self_invites),
    block_alt_farming: bool(s.block_alt_farming, base.block_alt_farming),
    rejoin_window_hours: clampInt(s.rejoin_window_hours, 0, INVITE_LIMITS.maxRejoinWindowHours, base.rejoin_window_hours),
    max_rejoins: clampInt(s.max_rejoins, 0, INVITE_LIMITS.maxRejoins, base.max_rejoins),
    spike_threshold: clampInt(s.spike_threshold, 0, INVITE_LIMITS.maxSpike, base.spike_threshold),
    dedup_rewards: bool(s.dedup_rewards, base.dedup_rewards),
    rewards_stack: bool(s.rewards_stack, base.rewards_stack),
    remove_on_drop: bool(s.remove_on_drop, base.remove_on_drop),
    notify_channel_id: typeof s.notify_channel_id === 'string' && s.notify_channel_id ? s.notify_channel_id : null,
    notify_on_join: bool(s.notify_on_join, base.notify_on_join),
    notify_on_valid: bool(s.notify_on_valid, base.notify_on_valid),
    notify_on_milestone: bool(s.notify_on_milestone, base.notify_on_milestone),
    notify_on_reward: bool(s.notify_on_reward, base.notify_on_reward),
    notify_on_invalid: bool(s.notify_on_invalid, base.notify_on_invalid),
  }
}

export function serialiseInviteSettings(c: InviteConfig): { enabled: boolean; settings: Record<string, unknown> } {
  const { enabled, ...settings } = c
  return { enabled, settings }
}

// ── Validity evaluation (bot-side, kept pure so both sides agree) ───────────────

export type ValidityInput = {
  /** Discord account age at evaluation time (days). */
  accountAgeDays: number
  /** How long the member has been in the server (hours). */
  stayHours: number
  completedOnboarding: boolean
  verified: boolean
  hasActiveFlags: boolean
  activityMessages: number
  isAlt: boolean
  isSelf: boolean
  /** How many times this member has rejoined. */
  rejoinCount: number
}

export type ValidityResult = { status: Exclude<InviteStatus, 'left'>; reason: string | null }

/**
 * Decide an invited member's status from the guild rules. Anti-abuse (fake)
 * takes precedence over the validity rules; permanent failures are `invalid`;
 * rules that can still be satisfied over time keep the join `pending`.
 */
export function evaluateInvite(cfg: InviteConfig, i: ValidityInput): ValidityResult {
  // Anti-abuse first — these mark the join as fake outright.
  if (cfg.block_self_invites && i.isSelf) return { status: 'fake', reason: 'self_invite' }
  if (cfg.block_alt_farming && i.isAlt) return { status: 'fake', reason: 'alt_account' }
  if (cfg.max_rejoins > 0 && i.rejoinCount >= cfg.max_rejoins) return { status: 'fake', reason: 'rejoin_abuse' }

  // Permanent invalidators (won't change by waiting).
  if (cfg.min_account_age_days > 0 && i.accountAgeDays < cfg.min_account_age_days) {
    return { status: 'invalid', reason: 'account_too_young' }
  }
  if (cfg.exclude_alts && i.isAlt) return { status: 'invalid', reason: 'likely_alt' }
  if (cfg.require_no_flags && i.hasActiveFlags) return { status: 'invalid', reason: 'moderation_flags' }

  // Time-dependent rules keep the join pending until satisfied.
  if (cfg.min_stay_hours > 0 && i.stayHours < cfg.min_stay_hours) return { status: 'pending', reason: 'awaiting_stay' }
  if (cfg.require_onboarding && !i.completedOnboarding) return { status: 'pending', reason: 'awaiting_onboarding' }
  if (cfg.require_verification && !i.verified) return { status: 'pending', reason: 'awaiting_verification' }
  if (cfg.min_activity_messages > 0 && i.activityMessages < cfg.min_activity_messages) {
    return { status: 'pending', reason: 'awaiting_activity' }
  }
  return { status: 'valid', reason: null }
}

// ── Snowflake → account age ──────────────────────────────────────────────────

const DISCORD_EPOCH = 1_420_070_400_000

/** Account creation Date from a Discord user snowflake. */
export function snowflakeToDate(id: string): Date | null {
  try {
    const ms = Number(BigInt(id) >> 22n) + DISCORD_EPOCH
    return Number.isFinite(ms) ? new Date(ms) : null
  } catch {
    return null
  }
}

export function accountAgeDays(createdAt: string | Date | null | undefined, now = new Date()): number {
  if (!createdAt) return 0
  const d = createdAt instanceof Date ? createdAt : new Date(createdAt)
  if (Number.isNaN(d.getTime())) return 0
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000))
}

export function hoursBetween(from: string | Date, to: Date = new Date()): number {
  const d = from instanceof Date ? from : new Date(from)
  if (Number.isNaN(d.getTime())) return 0
  return Math.max(0, (to.getTime() - d.getTime()) / 3_600_000)
}

// ── Leaderboard ─────────────────────────────────────────────────────────────────

export type InvitePeriod = 'day' | 'week' | 'month' | 'all'

export const PERIOD_OPTIONS: { value: InvitePeriod; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
]

/** ISO timestamp for the start of the leaderboard window, or null for all-time. */
export function periodSince(period: InvitePeriod, now = new Date()): string | null {
  if (period === 'all') return null
  const ms = period === 'day' ? 86_400_000 : period === 'week' ? 7 * 86_400_000 : 30 * 86_400_000
  return new Date(now.getTime() - ms).toISOString()
}

/**
 * Aggregate loaded invited_members into per-inviter rows (the same shape the
 * get_invite_leaderboard RPC returns), optionally windowed by join date. Lets
 * the dashboard recompute daily/weekly/monthly boards client-side from the rows
 * it already loaded, instead of a round trip per period switch.
 */
export function aggregateInviters(members: InvitedMember[], sinceIso: string | null): LeaderboardAggRow[] {
  const since = sinceIso ? new Date(sinceIso).getTime() : null
  const map = new Map<string, LeaderboardAggRow>()
  for (const m of members) {
    if (m.is_bonus || !m.inviter_id) continue
    if (since != null && new Date(m.joined_at).getTime() < since) continue
    let row = map.get(m.inviter_id)
    if (!row) {
      row = { inviter_id: m.inviter_id, inviter_name: m.inviter_name, total: 0, valid: 0, invalid: 0, fake: 0, left_count: 0, retained: 0 }
      map.set(m.inviter_id, row)
    }
    if (m.inviter_name) row.inviter_name = m.inviter_name
    row.total++
    if (m.status === 'valid') {
      row.valid++
      if (!m.left_at) row.retained++
    } else if (m.status === 'invalid') row.invalid++
    else if (m.status === 'fake') row.fake++
    else if (m.status === 'left') row.left_count++
  }
  return [...map.values()]
}

/** Aggregate row from get_invite_leaderboard. */
export type LeaderboardAggRow = {
  inviter_id: string
  inviter_name: string | null
  total: number
  valid: number
  invalid: number
  fake: number
  left_count: number
  retained: number
}

export type InviteLeaderRow = {
  rank: number
  inviter_id: string
  inviter_name: string | null
  total: number
  valid: number
  invalid: number
  fake: number
  left: number
  retained: number
  bonus: number
  /** valid + bonus - fake. */
  score: number
  /** retained / valid, 0-100. */
  retentionRate: number
  rewardsEarned: number
}

/**
 * Build the ranked leaderboard from the aggregate RPC rows, merging in bonus
 * credits (all-time only — a bonus is a lifetime adjustment, not period-bound)
 * and the count of rewards each inviter has earned.
 */
export function buildLeaderboard(
  agg: LeaderboardAggRow[],
  opts: {
    bonusByUser?: Map<string, number>
    rewardsByUser?: Map<string, number>
    includeBonus?: boolean
  } = {},
): InviteLeaderRow[] {
  const bonusByUser = opts.bonusByUser ?? new Map()
  const rewardsByUser = opts.rewardsByUser ?? new Map()
  const includeBonus = opts.includeBonus ?? true

  const rows: Omit<InviteLeaderRow, 'rank'>[] = agg.map((a) => {
    const bonus = includeBonus ? Math.max(0, bonusByUser.get(a.inviter_id) ?? 0) : 0
    const valid = num(a.valid)
    const fake = num(a.fake)
    return {
      inviter_id: a.inviter_id,
      inviter_name: a.inviter_name,
      total: num(a.total),
      valid,
      invalid: num(a.invalid),
      fake,
      left: num(a.left_count),
      retained: num(a.retained),
      bonus,
      score: valid + bonus - fake,
      retentionRate: valid > 0 ? Math.round((num(a.retained) / valid) * 100) : 0,
      rewardsEarned: rewardsByUser.get(a.inviter_id) ?? 0,
    }
  })

  // Bonus-only inviters (credited but with no attributed joins in the window)
  // still deserve a row when we're including bonuses.
  if (includeBonus) {
    const seen = new Set(rows.map((r) => r.inviter_id))
    for (const [inviterId, bonus] of bonusByUser) {
      if (bonus > 0 && !seen.has(inviterId)) {
        rows.push({
          inviter_id: inviterId,
          inviter_name: null,
          total: 0,
          valid: 0,
          invalid: 0,
          fake: 0,
          left: 0,
          retained: 0,
          bonus,
          score: bonus,
          retentionRate: 0,
          rewardsEarned: rewardsByUser.get(inviterId) ?? 0,
        })
      }
    }
  }

  rows.sort((a, b) => b.score - a.score || b.valid - a.valid || b.retained - a.retained)
  return rows.map((r, i) => ({ ...r, rank: i + 1 }))
}

/** Sum bonus credits per inviter from the adjustments log. */
export function bonusByUser(adjustments: InviteAdjustment[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const a of adjustments) {
    if (a.kind !== 'bonus' || !a.user_id) continue
    map.set(a.user_id, (map.get(a.user_id) ?? 0) + a.amount)
  }
  return map
}

/** Count non-revoked reward claims per inviter. */
export function rewardsByUser(claims: InviteRewardClaim[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const c of claims) {
    if (c.revoked_at) continue
    map.set(c.user_id, (map.get(c.user_id) ?? 0) + 1)
  }
  return map
}

// ── Overview stats ──────────────────────────────────────────────────────────────

export type InviteOverviewStats = {
  /** Distinct members ever attributed to an invite (excludes bonus placeholders). */
  totalJoins: number
  valid: number
  pending: number
  invalid: number
  fake: number
  left: number
  bonus: number
  retained: number
  /** Distinct inviters with at least one attributed join. */
  inviters: number
  /** valid + bonus - fake, guild-wide. */
  score: number
  /** Rewards granted (non-revoked). */
  rewardsGranted: number
  /** Retained / valid, 0-100. */
  retentionRate: number
}

export function computeInviteStats(
  members: InvitedMember[],
  adjustments: InviteAdjustment[],
  claims: InviteRewardClaim[] = [],
): InviteOverviewStats {
  let valid = 0, pending = 0, invalid = 0, fake = 0, left = 0, retained = 0, totalJoins = 0
  const inviters = new Set<string>()
  for (const m of members) {
    if (m.is_bonus) continue
    totalJoins++
    if (m.inviter_id) inviters.add(m.inviter_id)
    switch (m.status) {
      case 'valid':
        valid++
        if (!m.left_at) retained++
        break
      case 'pending':
        pending++
        break
      case 'invalid':
        invalid++
        break
      case 'fake':
        fake++
        break
      case 'left':
        left++
        break
    }
  }
  let bonus = 0
  for (const a of adjustments) if (a.kind === 'bonus') bonus += a.amount
  const rewardsGranted = claims.filter((c) => !c.revoked_at).length
  return {
    totalJoins,
    valid,
    pending,
    invalid,
    fake,
    left,
    bonus: Math.max(0, bonus),
    retained,
    inviters: inviters.size,
    score: valid + Math.max(0, bonus) - fake,
    rewardsGranted,
    retentionRate: valid > 0 ? Math.round((retained / valid) * 100) : 0,
  }
}

/** Daily join series (last `days` UTC days) split by valid vs other, for the chart. */
export function joinSeries(members: InvitedMember[], days = 14, now = new Date()): { date: string; total: number; valid: number }[] {
  const today = new Date(now)
  today.setUTCHours(0, 0, 0, 0)
  const total = new Map<string, number>()
  const valid = new Map<string, number>()
  for (const m of members) {
    if (m.is_bonus) continue
    const d = new Date(m.joined_at)
    if (Number.isNaN(d.getTime())) continue
    const key = d.toISOString().slice(0, 10)
    total.set(key, (total.get(key) ?? 0) + 1)
    if (m.status === 'valid') valid.set(key, (valid.get(key) ?? 0) + 1)
  }
  const out: { date: string; total: number; valid: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    out.push({ date: key, total: total.get(key) ?? 0, valid: valid.get(key) ?? 0 })
  }
  return out
}

// ── Small shared utilities ───────────────────────────────────────────────────

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}
