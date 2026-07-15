// Shared model + pure helpers for Temporary Roles (PULSIFY-54).
//
// Time-limited role grants surfaced in Server > Roles > Temporary Roles. Used
// on BOTH sides: the API routes shape rows as `TempRoleAssignment`, the client
// renders/sorts/searches from the same types, and the bot mirrors the expiry
// math (keep `pulse-bot/src/temporary-roles.js` in sync — same stance as
// giveaways.js ↔ lib/giveaways.ts).
//
// Everything here is pure (no DB / bot-token access), so it's safe to import
// into client components.

export const TEMP_ROLE_SOURCES = [
  'manual',
  'economy',
  'marketplace',
  'giveaway',
  'event',
  'birthday',
  'invite',
  'automation',
  'application',
  'moderation',
  'other',
] as const
export type TempRoleSource = (typeof TEMP_ROLE_SOURCES)[number]

export const SOURCE_META: Record<TempRoleSource, { label: string; icon: string; accent: string }> = {
  manual: { label: 'Manual Assignment', icon: 'Hand', accent: '#94a3b8' },
  economy: { label: 'Economy Purchase', icon: 'Coins', accent: '#f59e0b' },
  marketplace: { label: 'Marketplace Reward', icon: 'ShoppingBag', accent: '#22c55e' },
  giveaway: { label: 'Giveaway Reward', icon: 'Gift', accent: '#ec4899' },
  event: { label: 'Event Reward', icon: 'CalendarDays', accent: '#3b82f6' },
  birthday: { label: 'Birthday Role', icon: 'Cake', accent: '#f472b6' },
  invite: { label: 'Invite Reward', icon: 'UserPlus', accent: '#38bdf8' },
  automation: { label: 'Automation', icon: 'Zap', accent: '#eab308' },
  application: { label: 'Application Approval', icon: 'ClipboardCheck', accent: '#14b8a6' },
  moderation: { label: 'Moderation Action', icon: 'Shield', accent: '#ef4444' },
  other: { label: 'Other', icon: 'Sparkles', accent: '#a855f7' },
}

export function isTempRoleSource(v: unknown): v is TempRoleSource {
  return typeof v === 'string' && (TEMP_ROLE_SOURCES as readonly string[]).includes(v)
}

export const TEMP_ROLE_STATUSES = ['active', 'expired', 'removed'] as const
export type TempRoleStatus = (typeof TEMP_ROLE_STATUSES)[number]

export const STATUS_META: Record<TempRoleStatus, { label: string; color: string }> = {
  active: { label: 'Active', color: '#22c55e' },
  expired: { label: 'Expired', color: '#94a3b8' },
  removed: { label: 'Removed', color: '#ef4444' },
}

export type TempRoleEventAction = 'assigned' | 'extended' | 'shortened' | 'expired' | 'removed'

// ── Duration ────────────────────────────────────────────────────────────────

export const DURATION_UNITS = ['minutes', 'hours', 'days', 'weeks', 'months'] as const
export type DurationUnit = (typeof DURATION_UNITS)[number]

export const UNIT_LABELS: Record<DurationUnit, string> = {
  minutes: 'Minutes',
  hours: 'Hours',
  days: 'Days',
  weeks: 'Weeks',
  months: 'Months',
}

const MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }

/**
 * Add a {value, unit} duration to a base date. Months are calendar-aware
 * (advance the month field, clamped for short months) rather than a fixed
 * 30-day approximation; everything else is exact milliseconds.
 */
export function addDuration(from: Date, value: number, unit: DurationUnit): Date {
  const v = Math.max(0, Math.floor(value))
  if (unit === 'months') {
    const d = new Date(from)
    const day = d.getDate()
    d.setMonth(d.getMonth() + v)
    // Clamp Feb-31 → Feb-28/29 style overflow back to the last valid day.
    if (d.getDate() < day) d.setDate(0)
    return d
  }
  const per = unit === 'minutes' ? MS.minute : unit === 'hours' ? MS.hour : unit === 'weeks' ? MS.week : MS.day
  return new Date(from.getTime() + v * per)
}

/** Human label for a duration, e.g. "30 days", "24 hours", "1 month". */
export function formatDuration(value: number, unit: DurationUnit): string {
  const v = Math.max(0, Math.floor(value))
  const noun = unit.slice(0, -1) // "days" → "day"
  return `${v.toLocaleString()} ${noun}${v === 1 ? '' : 's'}`
}

export const MAX_DURATION_MS = 365 * 4 * MS.day // 4 years — a sane ceiling

/** Validate a future expiry against now; returns an error string or null. */
export function validateExpiry(expiresAt: Date, now = new Date()): string | null {
  if (Number.isNaN(expiresAt.getTime())) return 'Invalid expiration date.'
  if (expiresAt.getTime() <= now.getTime() + 30_000) return 'Expiration must be at least a minute in the future.'
  if (expiresAt.getTime() - now.getTime() > MAX_DURATION_MS) return 'Expiration can be at most 4 years out.'
  return null
}

// ── Remaining time ──────────────────────────────────────────────────────────

export const EXPIRING_SOON_MS = 24 * MS.hour
export const RECENTLY_EXPIRED_MS = 7 * MS.day

export function remainingMs(expiresAt: string | Date, now = Date.now()): number {
  const t = typeof expiresAt === 'string' ? Date.parse(expiresAt) : expiresAt.getTime()
  return t - now
}

/** Compact countdown, e.g. "2d 4h", "3h 12m", "<1m", "Expired". */
export function formatRemaining(expiresAt: string | Date, now = Date.now()): string {
  const ms = remainingMs(expiresAt, now)
  if (ms <= 0) return 'Expired'
  const d = Math.floor(ms / MS.day)
  const h = Math.floor((ms % MS.day) / MS.hour)
  const m = Math.floor((ms % MS.hour) / MS.minute)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return '<1m'
}

export function isExpiringSoon(expiresAt: string | Date, now = Date.now()): boolean {
  const ms = remainingMs(expiresAt, now)
  return ms > 0 && ms <= EXPIRING_SOON_MS
}

// ── Row shapes ──────────────────────────────────────────────────────────────

export type TempRoleAssignment = {
  id: string
  guild_id: string
  user_id: string
  user_name: string | null
  role_id: string
  role_name: string | null
  source: TempRoleSource
  reason: string | null
  assigned_by: string | null
  assigned_by_name: string | null
  assigned_at: string
  expires_at: string
  status: TempRoleStatus
  notify_user: boolean
  notify_admin: boolean
  ended_at: string | null
  ended_by: string | null
  created_at: string
  updated_at: string
}

export type TempRoleEvent = {
  id: string
  guild_id: string
  temporary_role_id: string | null
  user_id: string
  user_name: string | null
  role_id: string
  role_name: string | null
  action: TempRoleEventAction
  source: TempRoleSource
  actor_id: string | null
  actor_name: string | null
  detail: Record<string, unknown>
  created_at: string
}

// ── Stats for the monitoring dashboard ──────────────────────────────────────

export type TempRoleStats = {
  active: number
  expiringSoon: number
  recentlyExpired: number
  /** [{ roleId, roleName, count }] sorted desc — "most assigned". */
  byRole: { roleId: string; roleName: string | null; count: number }[]
  /** Per-day assignment counts for the last 14 days (oldest → newest). */
  trend: { date: string; count: number }[]
}

export function computeTempRoleStats(assignments: TempRoleAssignment[], now = Date.now()): TempRoleStats {
  let active = 0
  let expiringSoon = 0
  let recentlyExpired = 0
  const roleCounts = new Map<string, { roleName: string | null; count: number }>()

  for (const a of assignments) {
    if (a.status === 'active') {
      active++
      if (isExpiringSoon(a.expires_at, now)) expiringSoon++
    } else if (a.status === 'expired' && a.ended_at && now - Date.parse(a.ended_at) <= RECENTLY_EXPIRED_MS) {
      recentlyExpired++
    }
    const entry = roleCounts.get(a.role_id) ?? { roleName: a.role_name, count: 0 }
    entry.count++
    roleCounts.set(a.role_id, entry)
  }

  const byRole = [...roleCounts.entries()]
    .map(([roleId, v]) => ({ roleId, roleName: v.roleName, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // 14-day assignment trend keyed by local YYYY-MM-DD.
  const days: { date: string; count: number }[] = []
  const idx = new Map<string, number>()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * MS.day)
    const key = d.toISOString().slice(0, 10)
    idx.set(key, days.length)
    days.push({ date: key, count: 0 })
  }
  for (const a of assignments) {
    const key = a.assigned_at.slice(0, 10)
    const at = idx.get(key)
    if (at != null) days[at].count++
  }

  return { active, expiringSoon, recentlyExpired, byRole, trend: days }
}

/** Built-in quick presets surfaced in the assign panel. */
export const TEMP_ROLE_PRESETS: { label: string; value: number; unit: DurationUnit; source: TempRoleSource }[] = [
  { label: 'VIP — 30 days', value: 30, unit: 'days', source: 'manual' },
  { label: 'Event Access — 24 hours', value: 24, unit: 'hours', source: 'event' },
  { label: 'Giveaway Winner — 7 days', value: 7, unit: 'days', source: 'giveaway' },
  { label: 'Trial Moderator — 14 days', value: 14, unit: 'days', source: 'moderation' },
]
