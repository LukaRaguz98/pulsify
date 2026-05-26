// Giveaways & Community Engagement catalog + pure helpers (PULSIFY-24).
//
// No JSX / framework / IO imports live here: icons are referenced by lucide
// NAME (resolved in the UI layer), exactly like lib/tickets.ts,
// lib/insights.ts and lib/automations.ts. The dashboard and the bot both
// read/write the `giveaways` / `giveaway_entries` tables, so the status model,
// entry-requirement evaluation, winner-pick and the interaction custom_id
// scheme MUST agree between the two — keep this in sync with
// pulse-bot/src/giveaways.js the same way lib/tickets.ts ↔ tickets.js are.

// ── Statuses ──────────────────────────────────────────────────────────────────

export type GiveawayStatus = 'scheduled' | 'active' | 'ended' | 'cancelled'

export const STATUS_META: Record<
  GiveawayStatus,
  { label: string; icon: string; color: string; order: number }
> = {
  active:    { label: 'Active',    icon: 'Radio',       color: '#22c55e', order: 0 },
  scheduled: { label: 'Scheduled', icon: 'CalendarClock', color: '#3b82f6', order: 1 },
  ended:     { label: 'Ended',     icon: 'Trophy',      color: '#a855f7', order: 2 },
  cancelled: { label: 'Cancelled', icon: 'Ban',         color: '#94a3b8', order: 3 },
}

export function normaliseStatus(v: unknown): GiveawayStatus {
  return v === 'scheduled' || v === 'active' || v === 'ended' || v === 'cancelled'
    ? v
    : 'active'
}

/** A giveaway that is still running or waiting to run. */
export function isLiveStatus(status: string): boolean {
  return status === 'active' || status === 'scheduled'
}

// ── Entry requirements ──────────────────────────────────────────────────────
// Evaluated by the bot when a member clicks Join. All fields optional — an
// empty object means "anyone may enter".

export type RequiredRoleMode = 'any' | 'all'

export type GiveawayRequirements = {
  /** Member must hold these roles to enter. */
  required_role_ids: string[]
  /** Whether the member needs ANY of the required roles or ALL of them. */
  required_role_mode: RequiredRoleMode
  /** Discord account must be at least this many days old (anti-throwaway). */
  min_account_age_days: number
  /** Member must have been in THIS server at least this many days. */
  min_server_age_days: number
  /** Member must have sent at least this many tracked messages (engagement). */
  min_messages: number
  /**
   * Convenience anti-alt toggle: when on and no explicit account-age minimum is
   * set, a sensible default (30 days) is enforced. The bot reads `effectiveAccountAgeDays`.
   */
  anti_alt: boolean
}

export const ANTI_ALT_DEFAULT_DAYS = 30

export function defaultRequirements(): GiveawayRequirements {
  return {
    required_role_ids: [],
    required_role_mode: 'any',
    min_account_age_days: 0,
    min_server_age_days: 0,
    min_messages: 0,
    anti_alt: false,
  }
}

/** The account-age floor actually enforced, folding in the anti-alt toggle. */
export function effectiveAccountAgeDays(req: GiveawayRequirements): number {
  if (req.min_account_age_days > 0) return req.min_account_age_days
  return req.anti_alt ? ANTI_ALT_DEFAULT_DAYS : 0
}

/** True when a giveaway gates entry at all (drives the "Requirements" badge). */
export function hasRequirements(req: GiveawayRequirements): boolean {
  return (
    req.required_role_ids.length > 0 ||
    effectiveAccountAgeDays(req) > 0 ||
    req.min_server_age_days > 0 ||
    req.min_messages > 0
  )
}

// Facts the bot resolves about a member at Join time — kept as a plain shape so
// the eligibility rule itself is pure and unit-testable on either side.
export type EntrantFacts = {
  roleIds: string[]
  /** Account creation date (from the user snowflake). */
  accountCreatedAt: Date
  /** When the member joined THIS guild. */
  joinedAt: Date | null
  /** Count of tracked messages the member has sent in this guild. */
  messageCount: number
}

export type EligibilityResult = { ok: true } | { ok: false; reason: string }

/**
 * Decide whether a member may enter, given their facts. Pure — the bot resolves
 * the facts from Discord + analytics and calls this; the dashboard uses the same
 * function to describe requirements. Returns the FIRST failing reason so the
 * member gets one clear message.
 */
export function checkEligibility(
  req: GiveawayRequirements,
  facts: EntrantFacts,
  now: Date = new Date(),
): EligibilityResult {
  if (req.required_role_ids.length > 0) {
    const held = req.required_role_ids.filter((r) => facts.roleIds.includes(r))
    const ok = req.required_role_mode === 'all' ? held.length === req.required_role_ids.length : held.length > 0
    if (!ok) {
      return {
        ok: false,
        reason:
          req.required_role_mode === 'all'
            ? 'You need all of the required roles to enter this giveaway.'
            : 'You need one of the required roles to enter this giveaway.',
      }
    }
  }

  const accountAgeDays = req.anti_alt || req.min_account_age_days > 0
    ? daysBetween(facts.accountCreatedAt, now)
    : Infinity
  const accountFloor = effectiveAccountAgeDays(req)
  if (accountFloor > 0 && accountAgeDays < accountFloor) {
    return { ok: false, reason: `Your Discord account must be at least ${accountFloor} day${accountFloor === 1 ? '' : 's'} old to enter.` }
  }

  if (req.min_server_age_days > 0) {
    const memberDays = facts.joinedAt ? daysBetween(facts.joinedAt, now) : 0
    if (memberDays < req.min_server_age_days) {
      return { ok: false, reason: `You must have been in this server for at least ${req.min_server_age_days} day${req.min_server_age_days === 1 ? '' : 's'} to enter.` }
    }
  }

  if (req.min_messages > 0 && facts.messageCount < req.min_messages) {
    return { ok: false, reason: `You need at least ${req.min_messages} message${req.min_messages === 1 ? '' : 's'} in this server to enter.` }
  }

  return { ok: true }
}

/** Short human list of a giveaway's requirements, for the card / preview. */
export function describeRequirements(req: GiveawayRequirements): string[] {
  const out: string[] = []
  if (req.required_role_ids.length > 0) {
    const verb = req.required_role_mode === 'all' ? 'all of' : 'one of'
    out.push(`Have ${verb} ${req.required_role_ids.length} role${req.required_role_ids.length === 1 ? '' : 's'}`)
  }
  const acctFloor = effectiveAccountAgeDays(req)
  if (acctFloor > 0) out.push(`Account > ${acctFloor}d old`)
  if (req.min_server_age_days > 0) out.push(`Member > ${req.min_server_age_days}d`)
  if (req.min_messages > 0) out.push(`> ${req.min_messages} messages`)
  return out
}

// ── Presets (built-in templates that pre-fill the create form) ───────────────

export type GiveawayPreset = {
  id: string
  label: string
  icon: string
  title: string
  description: string
  prize: string
  winner_count: number
  /** Suggested duration in minutes (the form turns it into ends_at). */
  duration_minutes: number
  requirements: Partial<GiveawayRequirements>
}

export const GIVEAWAY_PRESETS: GiveawayPreset[] = [
  {
    id: 'quick',
    label: 'Quick drop',
    icon: 'Zap',
    title: '🎉 Quick Giveaway',
    description: 'React fast — a quick giveaway for everyone in the server!',
    prize: 'A surprise reward',
    winner_count: 1,
    duration_minutes: 60,
    requirements: {},
  },
  {
    id: 'nitro',
    label: 'Nitro',
    icon: 'Gift',
    title: '💜 Discord Nitro Giveaway',
    description: 'We\'re giving away **Discord Nitro**! Click Join below for a chance to win.',
    prize: 'Discord Nitro (1 month)',
    winner_count: 1,
    duration_minutes: 60 * 24,
    requirements: { anti_alt: true },
  },
  {
    id: 'members-only',
    label: 'Members only',
    icon: 'Users',
    title: '🎁 Members Giveaway',
    description: 'A thank-you giveaway for our active community members.',
    prize: 'Community reward',
    winner_count: 3,
    duration_minutes: 60 * 24 * 3,
    requirements: { min_messages: 50, min_server_age_days: 7 },
  },
  {
    id: 'milestone',
    label: 'Milestone',
    icon: 'Trophy',
    title: '🏆 Milestone Celebration Giveaway',
    description: 'Celebrating a big milestone together — thank you for being here!',
    prize: 'Special milestone prize',
    winner_count: 5,
    duration_minutes: 60 * 24 * 7,
    requirements: { anti_alt: true, min_server_age_days: 1 },
  },
]

// ── Interaction custom_ids (shared with pulse-bot/src/giveaways.js) ──────────
// The Join button on the giveaway message carries this id; the BOT handles the
// click. Keep identical to the GW constant in pulse-bot/src/giveaways.js.

export const GW = 'gw'
export const joinCustomId = (giveawayId: string) => `${GW}:join:${giveawayId}`

// ── Limits ──────────────────────────────────────────────────────────────────

export const GIVEAWAY_LIMITS = {
  maxWinners: 50,
  maxTitle: 100,
  maxDescription: 1500,
  maxPrize: 200,
  maxRequiredRoles: 10,
  maxBlacklist: 200,
  /** Discord won't accept a scheduled-event-like duration; we cap at 60 days. */
  maxDurationMinutes: 60 * 24 * 60,
  minDurationMinutes: 1,
} as const

// ── Giveaway record (as passed from the server page to the client UI) ─────────

export type GiveawayWinner = { id: string; name: string | null }

export type Giveaway = {
  id: string
  guild_id: string
  title: string
  description: string | null
  prize: string
  channel_id: string
  message_id: string | null
  winner_count: number
  status: GiveawayStatus
  requirements: GiveawayRequirements
  blacklist_user_ids: string[]
  starts_at: string | null
  ends_at: string
  winners: GiveawayWinner[]
  entry_count: number
  host_id: string | null
  host_name: string | null
  ended_at: string | null
  created_at: string
}

export type GiveawayEntry = {
  id: number
  giveaway_id: string
  user_id: string
  user_name: string | null
  entered_at: string
  is_winner: boolean
}

/** Coerce a loose DB row into a fully-shaped Giveaway. */
export function normaliseGiveaway(row: Record<string, unknown>): Giveaway {
  return {
    id: String(row.id),
    guild_id: String(row.guild_id),
    title: typeof row.title === 'string' ? row.title : 'Giveaway',
    description: typeof row.description === 'string' ? row.description : null,
    prize: typeof row.prize === 'string' ? row.prize : '',
    channel_id: typeof row.channel_id === 'string' ? row.channel_id : '',
    message_id: typeof row.message_id === 'string' ? row.message_id : null,
    winner_count: clampNum(row.winner_count, 1, GIVEAWAY_LIMITS.maxWinners, 1),
    status: normaliseStatus(row.status),
    requirements: normaliseRequirements(row.requirements),
    blacklist_user_ids: toStringArray(row.blacklist_user_ids),
    starts_at: (row.starts_at as string) ?? null,
    ends_at: typeof row.ends_at === 'string' ? row.ends_at : new Date().toISOString(),
    winners: normaliseWinners(row.winners),
    entry_count: clampNum(row.entry_count, 0, Number.MAX_SAFE_INTEGER, 0),
    host_id: (row.host_id as string) ?? null,
    host_name: (row.host_name as string) ?? null,
    ended_at: (row.ended_at as string) ?? null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
  }
}

export function normaliseRequirements(raw: unknown): GiveawayRequirements {
  const base = defaultRequirements()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  return {
    required_role_ids: toStringArray(r.required_role_ids).slice(0, GIVEAWAY_LIMITS.maxRequiredRoles),
    required_role_mode: r.required_role_mode === 'all' ? 'all' : 'any',
    min_account_age_days: clampNum(r.min_account_age_days, 0, 3650, 0),
    min_server_age_days: clampNum(r.min_server_age_days, 0, 3650, 0),
    min_messages: clampNum(r.min_messages, 0, 1_000_000, 0),
    anti_alt: Boolean(r.anti_alt),
  }
}

function normaliseWinners(raw: unknown): GiveawayWinner[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((w) => {
      if (!w || typeof w !== 'object') return null
      const o = w as Record<string, unknown>
      if (typeof o.id !== 'string') return null
      return { id: o.id, name: typeof o.name === 'string' ? o.name : null }
    })
    .filter((w): w is GiveawayWinner => w !== null)
}

// ── Validation (create / edit) ────────────────────────────────────────────────

export type GiveawayDraft = {
  title: string
  description: string
  prize: string
  channel_id: string
  winner_count: number
  /** Minutes from start until the giveaway ends. */
  duration_minutes: number
  /** Minutes from now until the giveaway STARTS (0 = start immediately). */
  start_delay_minutes: number
  requirements: GiveawayRequirements
  blacklist_user_ids: string[]
}

export function defaultDraft(): GiveawayDraft {
  return {
    title: '🎉 Giveaway',
    description: '',
    prize: '',
    channel_id: '',
    winner_count: 1,
    duration_minutes: 60 * 24,
    start_delay_minutes: 0,
    requirements: defaultRequirements(),
    blacklist_user_ids: [],
  }
}

/** Returns an error string if the draft can't be published, else null. */
export function validateDraft(d: GiveawayDraft): string | null {
  if (!d.title.trim()) return 'Give your giveaway a title.'
  if (!d.prize.trim()) return 'Describe the prize.'
  if (!d.channel_id) return 'Pick a channel to post the giveaway in.'
  if (d.winner_count < 1 || d.winner_count > GIVEAWAY_LIMITS.maxWinners) {
    return `Winner count must be between 1 and ${GIVEAWAY_LIMITS.maxWinners}.`
  }
  if (d.duration_minutes < GIVEAWAY_LIMITS.minDurationMinutes) {
    return 'The giveaway must run for at least a minute.'
  }
  if (d.duration_minutes > GIVEAWAY_LIMITS.maxDurationMinutes) {
    return 'A giveaway can run for at most 60 days.'
  }
  return null
}

// ── Winner pick (pure) ────────────────────────────────────────────────────────

/**
 * Fisher–Yates shuffle, then take the first `count` eligible ids. `exclude` is
 * removed first (blacklist + previous winners on a reroll). Pure + deterministic
 * given a seeded RNG, but uses Math.random by default. Returns ≤ count ids.
 */
export function pickWinners(
  entrantIds: string[],
  count: number,
  exclude: string[] = [],
  rng: () => number = Math.random,
): string[] {
  const excludeSet = new Set(exclude)
  const pool = [...new Set(entrantIds)].filter((id) => !excludeSet.has(id))
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, Math.max(0, count))
}

// ── Analytics (pure, derived from the loaded rows) ────────────────────────────

export type GiveawayStats = {
  total: number
  active: number
  scheduled: number
  ended: number
  cancelled: number
  totalEntries: number
  totalWinners: number
  /** Mean entrants across giveaways that have actually run (active+ended). */
  avgEntries: number
  /** Giveaways with the most entries (top 5). */
  topByEntries: { id: string; title: string; entries: number }[]
  /** Daily entry counts over the last `days` days (oldest → newest). */
  series: { date: string; giveaways: number; entries: number }[]
  /** Share of ended giveaways that drew at least one winner, 0–100. */
  completionRate: number
}

export function computeGiveawayStats(giveaways: Giveaway[], days = 14): GiveawayStats {
  let active = 0
  let scheduled = 0
  let ended = 0
  let cancelled = 0
  let totalEntries = 0
  let totalWinners = 0
  let runCount = 0
  let endedWithWinners = 0

  for (const g of giveaways) {
    if (g.status === 'active') active++
    else if (g.status === 'scheduled') scheduled++
    else if (g.status === 'ended') ended++
    else if (g.status === 'cancelled') cancelled++

    totalEntries += g.entry_count
    totalWinners += g.winners.length
    if (g.status === 'active' || g.status === 'ended') runCount++
    if (g.status === 'ended') {
      if (g.winners.length > 0) endedWithWinners++
    }
  }

  const topByEntries = [...giveaways]
    .sort((a, b) => b.entry_count - a.entry_count)
    .slice(0, 5)
    .map((g) => ({ id: g.id, title: g.title, entries: g.entry_count }))

  // Daily series keyed on created date.
  const series: { date: string; giveaways: number; entries: number }[] = []
  const dayMs = 86_400_000
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const buckets = new Map<string, { giveaways: number; entries: number }>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(startOfToday.getTime() - i * dayMs)
    buckets.set(d.toISOString().slice(0, 10), { giveaways: 0, entries: 0 })
  }
  for (const g of giveaways) {
    const key = g.created_at.slice(0, 10)
    const b = buckets.get(key)
    if (b) {
      b.giveaways++
      b.entries += g.entry_count
    }
  }
  for (const [date, v] of buckets) series.push({ date, ...v })

  return {
    total: giveaways.length,
    active,
    scheduled,
    ended,
    cancelled,
    totalEntries,
    totalWinners,
    avgEntries: runCount > 0 ? Math.round(totalEntries / runCount) : 0,
    topByEntries,
    series,
    completionRate: ended > 0 ? Math.round((endedWithWinners / ended) * 100) : 0,
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Compact human duration: "45m", "3h 12m", "2d 4h". */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000))
  if (totalMin < 60) return `${totalMin}m`
  const totalHr = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (totalHr < 24) return min > 0 ? `${totalHr}h ${min}m` : `${totalHr}h`
  const dys = Math.floor(totalHr / 24)
  const hr = totalHr % 24
  return hr > 0 ? `${dys}d ${hr}h` : `${dys}d`
}

/** Countdown label for a future instant: "in 3d 4h", "in 12m", "ending now". */
export function formatCountdown(targetIso: string, now: number = Date.now()): string {
  const ms = new Date(targetIso).getTime() - now
  if (ms <= 0) return 'ending now'
  return `in ${formatDuration(ms)}`
}

/** Relative timestamp: "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60000) return 'just now'
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const dys = Math.floor(hr / 24)
  if (dys < 30) return `${dys}d ago`
  return new Date(iso).toLocaleDateString()
}

// ── Small shared utilities ────────────────────────────────────────────────────

export function isHexColor(v: unknown): boolean {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
}

export function hexToInt(hex: string): number {
  const v = parseInt(String(hex).replace('#', ''), 16)
  return Number.isNaN(v) ? 0x8b5cf6 : v
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000)
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}
