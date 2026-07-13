// Birthday System — pure model + helpers (PULSIFY-58).
//
// Members set a birthday (day/month, optional year) and Pulse celebrates it
// automatically. This module holds all the pure logic used on BOTH sides: the
// dashboard renders/sorts/validates from these types, and the bot mirrors the
// date + settings math in pulse-bot/src/birthdays.js — keep the two in sync the
// same way lib/leveling.ts ↔ leveling.js are.
//
// No JSX / framework / IO imports live here (icons are lucide NAMES resolved in
// the UI layer), so this is safe to import into client components.

// ── Months ────────────────────────────────────────────────────────────────────

export const MONTHS: { name: string; short: string; days: number }[] = [
  { name: 'January', short: 'Jan', days: 31 },
  { name: 'February', short: 'Feb', days: 29 }, // 29 to allow leap-day birthdays
  { name: 'March', short: 'Mar', days: 31 },
  { name: 'April', short: 'Apr', days: 30 },
  { name: 'May', short: 'May', days: 31 },
  { name: 'June', short: 'Jun', days: 30 },
  { name: 'July', short: 'Jul', days: 31 },
  { name: 'August', short: 'Aug', days: 31 },
  { name: 'September', short: 'Sep', days: 30 },
  { name: 'October', short: 'Oct', days: 31 },
  { name: 'November', short: 'Nov', days: 30 },
  { name: 'December', short: 'Dec', days: 31 },
]

export function monthName(month: number): string {
  return MONTHS[month - 1]?.name ?? ''
}

export function daysInMonth(month: number): number {
  return MONTHS[month - 1]?.days ?? 31
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

// ── Validation ────────────────────────────────────────────────────────────────

export const MIN_BIRTH_YEAR = 1900

/** Newest allowed birth year — Discord's minimum age is 13. */
export function maxBirthYear(now = new Date()): number {
  return now.getUTCFullYear() - 13
}

/** Validate a member's chosen birthday; returns an error string or null. */
export function validateBirthday(
  month: number,
  day: number,
  year?: number | null,
  now = new Date(),
): string | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 'Pick a valid month.'
  if (!Number.isInteger(day) || day < 1) return 'Pick a valid day.'
  if (day > daysInMonth(month)) return `${monthName(month)} only has ${daysInMonth(month)} days.`
  if (year != null && year !== 0) {
    if (!Number.isInteger(year)) return 'Enter a valid year.'
    if (year < MIN_BIRTH_YEAR) return `Year must be ${MIN_BIRTH_YEAR} or later.`
    if (year > maxBirthYear(now)) return 'You must be at least 13 to use this.'
    // Guard against Feb 29 on a non-leap birth year.
    if (month === 2 && day === 29 && !isLeapYear(year)) return `${year} is not a leap year.`
  }
  return null
}

// ── Timezone-aware "today" evaluation ──────────────────────────────────────────
// We evaluate a birthday against the member's LOCAL calendar day. Intl gives us
// the wall-clock date/hour in any IANA zone with no dependency.

export type TzParts = { year: number; month: number; day: number; hour: number }

export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Wall-clock Y/M/D/hour for `date` in `timeZone` (falls back to UTC). */
export function partsInTimeZone(date: Date, timeZone: string): TzParts {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      hour12: false,
    })
    const map: Record<string, number> = {}
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== 'literal') map[p.type] = Number(p.value)
    }
    let hour = map.hour ?? 0
    if (hour === 24) hour = 0 // some engines emit "24" for midnight
    return { year: map.year, month: map.month, day: map.day, hour }
  } catch {
    if ((timeZone || 'UTC') !== 'UTC') return partsInTimeZone(date, 'UTC')
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
    }
  }
}

/** The effective celebration day for `month`/`day` in a given year (Feb 29 → Feb 28 in non-leap years). */
export function effectiveDay(month: number, day: number, year: number): number {
  if (month === 2 && day === 29 && !isLeapYear(year)) return 28
  return day
}

/** Does the birthday fall on the local calendar day described by `parts`? */
export function birthdayOccursOn(month: number, day: number, parts: TzParts): boolean {
  return parts.month === month && parts.day === effectiveDay(month, day, parts.year)
}

/**
 * Whole days until the next occurrence of month/day, evaluated in `timeZone`.
 * 0 means it is today. Uses UTC-midnight arithmetic purely for day counting, so
 * DST transitions never skew the result.
 */
export function daysUntilBirthday(month: number, day: number, now = new Date(), timeZone = 'UTC'): number {
  const t = partsInTimeZone(now, timeZone)
  const today = Date.UTC(t.year, t.month - 1, t.day)
  let next = Date.UTC(t.year, month - 1, effectiveDay(month, day, t.year))
  if (next < today) {
    const ny = t.year + 1
    next = Date.UTC(ny, month - 1, effectiveDay(month, day, ny))
  }
  return Math.round((next - today) / 86_400_000)
}

/** Calendar year of the NEXT occurrence of this birthday (this year or next). */
export function nextBirthdayYear(month: number, day: number, now = new Date(), timeZone = 'UTC'): number {
  const t = partsInTimeZone(now, timeZone)
  const today = Date.UTC(t.year, t.month - 1, t.day)
  const days = daysUntilBirthday(month, day, now, timeZone)
  return new Date(today + days * 86_400_000).getUTCFullYear()
}

/** Age a member turns on their next birthday (null when the birth year is unknown). */
export function ageTurning(birthYear: number | null | undefined, month: number, day: number, now = new Date(), timeZone = 'UTC'): number | null {
  if (!birthYear) return null
  return Math.max(0, nextBirthdayYear(month, day, now, timeZone) - birthYear)
}

/** Age turned when celebrated in a specific calendar year. */
export function ageInYear(birthYear: number | null | undefined, calendarYear: number): number | null {
  if (!birthYear) return null
  return Math.max(0, calendarYear - birthYear)
}

// ── Formatting ─────────────────────────────────────────────────────────────────

/** "March 14" or "March 14, 1998" (year only when known + not hidden). */
export function formatBirthday(month: number, day: number, year?: number | null, showYear = true): string {
  const base = `${monthName(month)} ${day}`
  return year && showYear ? `${base}, ${year}` : base
}

/** Human countdown label for a day delta. */
export function countdownLabel(days: number): string {
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7) return `in ${days} days`
  if (days < 30) {
    const w = Math.round(days / 7)
    return `in ${w} week${w === 1 ? '' : 's'}`
  }
  const mo = Math.round(days / 30)
  return `in ${mo} month${mo === 1 ? '' : 's'}`
}

// ── Row shapes ─────────────────────────────────────────────────────────────────

export type MemberBirthday = {
  id: string
  guild_id: string
  user_id: string
  user_name: string | null
  birth_month: number
  birth_day: number
  birth_year: number | null
  timezone: string | null
  show_year: boolean
  announce: boolean
  created_at: string
  updated_at: string
}

export type BirthdayEvent = {
  id: string
  guild_id: string
  user_id: string
  user_name: string | null
  year: number
  age: number | null
  announced: boolean
  channel_id: string | null
  message_id: string | null
  role_id: string | null
  rewards: Record<string, unknown>
  created_at: string
}

/** A birthday decorated with its countdown, resolved against a reference now. */
export type UpcomingBirthday = {
  birthday: MemberBirthday
  daysUntil: number
  isToday: boolean
  age: number | null
}

/**
 * Decorate + sort birthdays by soonest upcoming. Each member's own timezone is
 * used (falling back to the guild default) so the countdown reflects their day.
 */
export function upcomingBirthdays(
  list: MemberBirthday[],
  opts: { now?: Date; guildTimezone?: string; windowDays?: number } = {},
): UpcomingBirthday[] {
  const now = opts.now ?? new Date()
  const guildTz = opts.guildTimezone || 'UTC'
  const out: UpcomingBirthday[] = list.map((b) => {
    const tz = b.timezone && isValidTimeZone(b.timezone) ? b.timezone : guildTz
    const daysUntil = daysUntilBirthday(b.birth_month, b.birth_day, now, tz)
    return {
      birthday: b,
      daysUntil,
      isToday: daysUntil === 0,
      age: ageTurning(b.birth_year, b.birth_month, b.birth_day, now, tz),
    }
  })
  const filtered = opts.windowDays != null ? out.filter((u) => u.daysUntil <= opts.windowDays!) : out
  return filtered.sort((a, b) => a.daysUntil - b.daysUntil || (a.birthday.user_name ?? '').localeCompare(b.birthday.user_name ?? ''))
}

// ── Settings ─────────────────────────────────────────────────────────────────

export type BirthdayMention = 'none' | 'user' | 'here' | 'everyone'

export const MENTION_OPTIONS: { value: BirthdayMention; label: string }[] = [
  { value: 'user', label: 'Mention the birthday member' },
  { value: 'none', label: 'No mention' },
  { value: 'here', label: '@here' },
  { value: 'everyone', label: '@everyone' },
]

export type BirthdayConfig = {
  enabled: boolean
  /** Channel the announcement is posted to (null = not configured yet). */
  channel_id: string | null
  /** Local hour (0-23, in `timezone`) at which the daily celebration runs. */
  announce_hour: number
  /** Guild default IANA timezone for the announce hour + members without one. */
  timezone: string
  /** Announcement template; placeholders {user} {mention} {server} {age} {date}. */
  message: string
  /** Who to ping in the announcement. */
  mention: BirthdayMention
  /** Optional decorative image (https URL). */
  image_url: string | null
  /** Optional link button under the announcement. */
  button_label: string | null
  button_url: string | null
  // ── Temporary birthday role ──
  /** Role granted for the day (null = no birthday role). */
  role_id: string | null
  role_auto_assign: boolean
  role_auto_remove: boolean
  /** How long the role is held when auto-removing (hours). */
  role_duration_hours: number
  // ── Rewards ──
  reward_coins: number
  reward_xp: number
  /** Permanent custom roles granted on a birthday. */
  reward_role_ids: string[]
}

export const DEFAULT_BIRTHDAY_MESSAGE =
  'Happy birthday, {mention}! Everyone at {server} wishes you an amazing day.'

export const BIRTHDAY_LIMITS = {
  maxMessage: 500,
  maxButtonLabel: 80,
  maxRewardCoins: 1_000_000,
  maxRewardXp: 1_000_000,
  maxRoleDurationHours: 24 * 14, // 14 days
  maxRewardRoles: 10,
} as const

export function defaultBirthdayConfig(): BirthdayConfig {
  return {
    enabled: false,
    channel_id: null,
    announce_hour: 9,
    timezone: 'UTC',
    message: DEFAULT_BIRTHDAY_MESSAGE,
    mention: 'user',
    image_url: null,
    button_label: null,
    button_url: null,
    role_id: null,
    role_auto_assign: true,
    role_auto_remove: true,
    role_duration_hours: 24,
    reward_coins: 0,
    reward_xp: 0,
    reward_role_ids: [],
  }
}

type BirthdayRow = { enabled?: boolean | null; settings?: unknown } | null | undefined

function httpsUrlOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  try {
    const u = new URL(v.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

/** Coerce a birthday_settings row (or null) into a fully-shaped config. */
export function normaliseBirthdaySettings(row: BirthdayRow): BirthdayConfig {
  const base = defaultBirthdayConfig()
  if (!row) return base
  const enabled = typeof row.enabled === 'boolean' ? row.enabled : base.enabled
  const s = row.settings && typeof row.settings === 'object' ? (row.settings as Record<string, unknown>) : {}

  const tz = typeof s.timezone === 'string' && isValidTimeZone(s.timezone) ? s.timezone : base.timezone

  return {
    enabled,
    channel_id: typeof s.channel_id === 'string' && s.channel_id ? s.channel_id : null,
    announce_hour: clampInt(s.announce_hour, 0, 23, base.announce_hour),
    timezone: tz,
    message:
      typeof s.message === 'string' && s.message.trim()
        ? s.message.slice(0, BIRTHDAY_LIMITS.maxMessage)
        : base.message,
    mention: normaliseMention(s.mention),
    image_url: httpsUrlOrNull(s.image_url),
    button_label:
      typeof s.button_label === 'string' && s.button_label.trim()
        ? s.button_label.slice(0, BIRTHDAY_LIMITS.maxButtonLabel)
        : null,
    button_url: httpsUrlOrNull(s.button_url),
    role_id: typeof s.role_id === 'string' && s.role_id ? s.role_id : null,
    role_auto_assign: s.role_auto_assign == null ? base.role_auto_assign : Boolean(s.role_auto_assign),
    role_auto_remove: s.role_auto_remove == null ? base.role_auto_remove : Boolean(s.role_auto_remove),
    role_duration_hours: clampInt(s.role_duration_hours, 1, BIRTHDAY_LIMITS.maxRoleDurationHours, base.role_duration_hours),
    reward_coins: clampInt(s.reward_coins, 0, BIRTHDAY_LIMITS.maxRewardCoins, base.reward_coins),
    reward_xp: clampInt(s.reward_xp, 0, BIRTHDAY_LIMITS.maxRewardXp, base.reward_xp),
    reward_role_ids: toStringArray(s.reward_role_ids).slice(0, BIRTHDAY_LIMITS.maxRewardRoles),
  }
}

/** Split a config back into the { enabled, settings } persistence shape. */
export function serialiseBirthdaySettings(c: BirthdayConfig): { enabled: boolean; settings: Record<string, unknown> } {
  const { enabled, ...settings } = c
  return { enabled, settings }
}

/** True when at least one reward (coins/XP/custom role) is configured. */
export function hasRewards(c: BirthdayConfig): boolean {
  return c.reward_coins > 0 || c.reward_xp > 0 || c.reward_role_ids.length > 0
}

function normaliseMention(v: unknown): BirthdayMention {
  return v === 'none' || v === 'user' || v === 'here' || v === 'everyone' ? v : 'user'
}

// ── Message templating ─────────────────────────────────────────────────────────

export type BirthdayMessageContext = {
  user: string
  mention: string
  server: string
  /** Age turned; '' when unknown/hidden. */
  age: number | string
  /** Formatted birthday date, e.g. "March 14". */
  date: string
}

/** Substitute {user} {mention} {server} {age} {date} placeholders. */
export function renderBirthdayMessage(template: string, ctx: BirthdayMessageContext): string {
  return template
    .replace(/\{user\}/g, ctx.user)
    .replace(/\{mention\}/g, ctx.mention)
    .replace(/\{server\}/g, ctx.server)
    .replace(/\{age\}/g, String(ctx.age))
    .replace(/\{date\}/g, ctx.date)
}

// ── Stats (dashboard at-a-glance) ───────────────────────────────────────────────

export type BirthdayStats = {
  total: number
  withYear: number
  todayCount: number
  next7: number
  next30: number
  /** Celebrations recorded in the current calendar year. */
  celebratedThisYear: number
  /** Per-month set counts (index 0 = January). */
  byMonth: number[]
}

export function computeBirthdayStats(
  list: MemberBirthday[],
  events: BirthdayEvent[],
  opts: { now?: Date; guildTimezone?: string } = {},
): BirthdayStats {
  const now = opts.now ?? new Date()
  const guildTz = opts.guildTimezone || 'UTC'
  const year = partsInTimeZone(now, guildTz).year
  const byMonth = new Array(12).fill(0)
  let withYear = 0
  let todayCount = 0
  let next7 = 0
  let next30 = 0

  for (const b of list) {
    byMonth[Math.max(0, Math.min(11, b.birth_month - 1))]++
    if (b.birth_year) withYear++
    const tz = b.timezone && isValidTimeZone(b.timezone) ? b.timezone : guildTz
    const d = daysUntilBirthday(b.birth_month, b.birth_day, now, tz)
    if (d === 0) todayCount++
    if (d <= 7) next7++
    if (d <= 30) next30++
  }

  const celebratedThisYear = events.filter((e) => e.year === year).length

  return { total: list.length, withYear, todayCount, next7, next30, celebratedThisYear, byMonth }
}

// ── Curated timezone list (dashboard + command choices) ─────────────────────────

export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Sao_Paulo', label: 'Brazil (São Paulo)' },
  { value: 'Europe/London', label: 'UK (London)' },
  { value: 'Europe/Paris', label: 'Central Europe (Paris)' },
  { value: 'Europe/Athens', label: 'Eastern Europe (Athens)' },
  { value: 'Europe/Moscow', label: 'Moscow' },
  { value: 'Asia/Dubai', label: 'Gulf (Dubai)' },
  { value: 'Asia/Kolkata', label: 'India (Kolkata)' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Tokyo', label: 'Japan (Tokyo)' },
  { value: 'Australia/Sydney', label: 'Sydney' },
  { value: 'Pacific/Auckland', label: 'New Zealand (Auckland)' },
]

// ── Small shared utilities ───────────────────────────────────────────────────

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))]
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}
