// Scheduled Automations — the canonical catalog of workflow ACTION types and
// SCHEDULE kinds, plus the per-guild workflow shape, defaults, validation,
// schedule maths and presets shared across the dashboard (page, content,
// edit panel, analytics).
//
// This is the source of truth for *what can be automated* and *how schedules
// resolve to fire times*. The bot mirrors the schedule maths + action dispatch
// in `pulse-bot/src/scheduler.js` — keep the two in sync (same action_type and
// schedule_type strings, same next-run semantics). Per-server workflows live in
// the `scheduled_automations` table; their run history in `automation_runs`.

// ── Action types ──────────────────────────────────────────────────────────────

export type ActionType =
  | 'announcement'
  | 'welcome_reminder'
  | 'analytics_summary'
  | 'role_sync'
  | 'temp_role_removal'
  | 'scheduled_moderation'
  | 'recurring_event'
  | 'inactivity_cleanup'

/** What kind of input field a given action config key needs in the builder. */
export type ActionFieldKind =
  | 'channel'
  | 'role'
  | 'message'
  | 'text'
  | 'number'
  | 'select'

export type ActionFieldDef = {
  key: string
  label: string
  kind: ActionFieldKind
  hint?: string
  required?: boolean
  placeholder?: string
  min?: number
  max?: number
  options?: { value: string; label: string }[]
  /** Default applied when a fresh action of this type is created. */
  default?: string | number
}

export type ActionDef = {
  type: ActionType
  label: string
  description: string
  /** lucide-react icon name — resolved to a component in the UI layer. */
  icon: string
  /** Accent colour used for the action's icon chip + badges. */
  color: string
  fields: ActionFieldDef[]
}

// A deliberately useful, safe set. Destructive actions (kicks, mass DMs) are
// intentionally omitted — automations either post content, manage a single
// role, lock a channel, or schedule an event.
export const ACTION_CATALOG: ActionDef[] = [
  {
    type: 'announcement',
    label: 'Announcement',
    description: 'Post a scheduled message to a channel.',
    icon: 'Megaphone',
    color: '#60a5fa',
    fields: [
      { key: 'channel_id', label: 'Channel', kind: 'channel', required: true, hint: 'Where the announcement is posted.' },
      { key: 'message', label: 'Message', kind: 'message', required: true, hint: 'Supports {server} and {memberCount} placeholders.' },
      {
        key: 'mention', label: 'Ping', kind: 'select', default: 'none',
        options: [
          { value: 'none', label: 'No ping' },
          { value: 'everyone', label: '@everyone' },
          { value: 'here', label: '@here' },
        ],
      },
    ],
  },
  {
    type: 'welcome_reminder',
    label: 'Recurring Reminder',
    description: 'Post a recurring reminder — rules, links, or a nudge to a channel.',
    icon: 'BellRing',
    color: '#f59e0b',
    fields: [
      { key: 'channel_id', label: 'Channel', kind: 'channel', required: true },
      { key: 'message', label: 'Reminder', kind: 'message', required: true, hint: 'Supports {server} and {memberCount} placeholders.' },
    ],
  },
  {
    type: 'analytics_summary',
    label: 'Analytics Summary',
    description: 'Post a recurring activity digest (messages, joins, active members).',
    icon: 'BarChart3',
    color: '#a855f7',
    fields: [
      { key: 'channel_id', label: 'Channel', kind: 'channel', required: true, hint: 'Where the digest is posted.' },
      {
        key: 'period', label: 'Period covered', kind: 'select', default: '24h',
        options: [
          { value: '24h', label: 'Last 24 hours' },
          { value: '7d', label: 'Last 7 days' },
          { value: '30d', label: 'Last 30 days' },
        ],
      },
    ],
  },
  {
    type: 'role_sync',
    label: 'Role Sync',
    description: 'Add a role to everyone missing it, or strip it from everyone who has it.',
    icon: 'Users',
    color: '#22c55e',
    fields: [
      { key: 'role_id', label: 'Role', kind: 'role', required: true },
      {
        key: 'mode', label: 'Operation', kind: 'select', default: 'add_to_all',
        options: [
          { value: 'add_to_all', label: 'Give role to all members' },
          { value: 'remove_from_all', label: 'Remove role from all members' },
        ],
      },
    ],
  },
  {
    type: 'temp_role_removal',
    label: 'Temporary Role Cleanup',
    description: 'Periodically clear a temporary role (event, daily, muted-cooldown) from everyone.',
    icon: 'Timer',
    color: '#fb7185',
    fields: [
      { key: 'role_id', label: 'Role to clear', kind: 'role', required: true, hint: 'Removed from every member who currently has it.' },
    ],
  },
  {
    type: 'scheduled_moderation',
    label: 'Scheduled Moderation',
    description: 'Lock/unlock a channel or set slowmode on a schedule (e.g. nightly quiet hours).',
    icon: 'Lock',
    color: '#ef4444',
    fields: [
      { key: 'channel_id', label: 'Channel', kind: 'channel', required: true },
      {
        key: 'operation', label: 'Action', kind: 'select', default: 'lock',
        options: [
          { value: 'lock', label: 'Lock channel (deny @everyone send)' },
          { value: 'unlock', label: 'Unlock channel (restore @everyone send)' },
          { value: 'slowmode', label: 'Set slowmode' },
        ],
      },
      { key: 'slowmode_seconds', label: 'Slowmode (seconds)', kind: 'number', min: 0, max: 21600, default: 0, hint: 'Only used by the slowmode action. 0 disables slowmode.' },
    ],
  },
  {
    type: 'recurring_event',
    label: 'Recurring Event',
    description: 'Create a Discord scheduled event each time the workflow fires.',
    icon: 'CalendarPlus',
    color: '#818cf8',
    fields: [
      { key: 'event_name', label: 'Event name', kind: 'text', required: true, placeholder: 'Weekly Community Call' },
      { key: 'description', label: 'Description', kind: 'message', hint: 'Optional details shown on the event.' },
      { key: 'location', label: 'Location', kind: 'text', placeholder: 'Main Stage / a link / a place', hint: 'External location shown to members.' },
      { key: 'duration_minutes', label: 'Duration (minutes)', kind: 'number', min: 15, max: 1440, default: 60 },
    ],
  },
  {
    type: 'inactivity_cleanup',
    label: 'Inactivity Report',
    description: 'Flag members with no recent activity — report them, or strip a role.',
    icon: 'UserMinus',
    color: '#94a3b8',
    fields: [
      { key: 'inactive_days', label: 'Inactive for (days)', kind: 'number', min: 1, max: 365, default: 30, required: true, hint: 'No tracked messages in this many days counts as inactive.' },
      { key: 'channel_id', label: 'Report channel', kind: 'channel', required: true, hint: 'Where the inactivity report is posted.' },
      {
        key: 'mode', label: 'Action', kind: 'select', default: 'report',
        options: [
          { value: 'report', label: 'Post a report only (safe)' },
          { value: 'remove_role', label: 'Post a report and remove a role' },
        ],
      },
      { key: 'role_id', label: 'Role to remove', kind: 'role', hint: 'Only used when "remove a role" is selected.' },
    ],
  },
]

export const ACTION_BY_TYPE: Record<ActionType, ActionDef> = Object.fromEntries(
  ACTION_CATALOG.map((a) => [a.type, a]),
) as Record<ActionType, ActionDef>

export const ACTION_TYPES = ACTION_CATALOG.map((a) => a.type)

// ── Schedule types ──────────────────────────────────────────────────────────

export type ScheduleType = 'daily' | 'weekly' | 'monthly' | 'interval' | 'cron'
export type IntervalUnit = 'minutes' | 'hours' | 'days'

export type ScheduleConfig = {
  /** "HH:MM" 24h local time — daily/weekly/monthly. */
  time?: string
  /** 0=Sun … 6=Sat — weekly. */
  days?: number[]
  /** Day of month 1–31 (clamped to the month length) — monthly. */
  day?: number
  /** interval. */
  every?: number
  unit?: IntervalUnit
  /** 5-field cron expression "m h dom mon dow" — cron. */
  expr?: string
}

export const SCHEDULE_META: Record<ScheduleType, { label: string; description: string }> = {
  daily: { label: 'Daily', description: 'Once a day at a set time.' },
  weekly: { label: 'Weekly', description: 'On chosen weekdays at a set time.' },
  monthly: { label: 'Monthly', description: 'On a day of the month at a set time.' },
  interval: { label: 'Every…', description: 'A fixed interval after the last run.' },
  cron: { label: 'Custom (cron)', description: 'A standard 5-field cron expression.' },
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// A curated timezone list for the picker — the bot accepts any IANA zone, but
// the dropdown stays manageable. "UTC" first as the safe default.
export const TIMEZONES: { value: string; label: string }[] = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Sao_Paulo', label: 'Brazil (São Paulo)' },
  { value: 'Europe/London', label: 'UK (London)' },
  { value: 'Europe/Paris', label: 'Central Europe (Paris)' },
  { value: 'Europe/Berlin', label: 'Central Europe (Berlin)' },
  { value: 'Europe/Moscow', label: 'Moscow' },
  { value: 'Asia/Dubai', label: 'Gulf (Dubai)' },
  { value: 'Asia/Kolkata', label: 'India (Kolkata)' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Tokyo', label: 'Japan (Tokyo)' },
  { value: 'Australia/Sydney', label: 'Sydney' },
  { value: 'Pacific/Auckland', label: 'Auckland' },
]

// ── Conditions ────────────────────────────────────────────────────────────────

export type Conditions = {
  /** Skip the run unless the guild has at least this many members. */
  min_members?: number
  /** Skip the run if the guild has more than this many members. */
  max_members?: number
}

// ── Per-guild workflow ──────────────────────────────────────────────────────

export type RunStatus = 'success' | 'failed' | 'skipped' | 'retrying'

/** Mirror of a `scheduled_automations` row as the dashboard consumes it. */
export type Automation = {
  id: string
  guild_id: string
  name: string
  enabled: boolean
  action_type: ActionType
  action_config: Record<string, unknown>
  schedule_type: ScheduleType
  schedule_config: ScheduleConfig
  timezone: string
  conditions: Conditions
  cooldown_minutes: number
  max_retries: number
  next_run_at: string | null
  last_run_at: string | null
  last_status: RunStatus | null
  run_count: number
  fail_count: number
  created_at: string
  updated_at: string
}

/** The editable subset a draft carries before it's persisted. */
export type AutomationDraft = {
  id?: string
  name: string
  enabled: boolean
  action_type: ActionType
  action_config: Record<string, unknown>
  schedule_type: ScheduleType
  schedule_config: ScheduleConfig
  timezone: string
  conditions: Conditions
  cooldown_minutes: number
  max_retries: number
}

export function defaultActionConfig(type: ActionType): Record<string, unknown> {
  const cfg: Record<string, unknown> = {}
  for (const f of ACTION_BY_TYPE[type].fields) {
    if (f.default !== undefined) cfg[f.key] = f.default
  }
  return cfg
}

export function defaultDraft(): AutomationDraft {
  return {
    name: '',
    enabled: true,
    action_type: 'announcement',
    action_config: defaultActionConfig('announcement'),
    schedule_type: 'daily',
    schedule_config: { time: '09:00' },
    timezone: 'UTC',
    conditions: {},
    cooldown_minutes: 0,
    max_retries: 0,
  }
}

// ── Normalisation (defensive coercion of untrusted rows/drafts) ────────────────

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function isActionType(v: unknown): v is ActionType {
  return typeof v === 'string' && ACTION_TYPES.includes(v as ActionType)
}

function isScheduleType(v: unknown): v is ScheduleType {
  return v === 'daily' || v === 'weekly' || v === 'monthly' || v === 'interval' || v === 'cron'
}

/** "HH:MM" 24h, defaulting to "09:00" on anything malformed. */
export function normaliseTime(v: unknown): string {
  if (typeof v !== 'string') return '09:00'
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return '09:00'
  const h = Math.max(0, Math.min(23, Number(m[1])))
  const mi = Math.max(0, Math.min(59, Number(m[2])))
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

function normaliseScheduleConfig(type: ScheduleType, raw: unknown): ScheduleConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  switch (type) {
    case 'daily':
      return { time: normaliseTime(r.time) }
    case 'weekly': {
      const days = Array.isArray(r.days)
        ? [...new Set(r.days.map((d) => clampInt(d, 0, 6, 0)))].sort((a, b) => a - b)
        : [1]
      return { time: normaliseTime(r.time), days: days.length ? days : [1] }
    }
    case 'monthly':
      return { time: normaliseTime(r.time), day: clampInt(r.day ?? 1, 1, 31, 1) }
    case 'interval': {
      const unit: IntervalUnit =
        r.unit === 'minutes' || r.unit === 'hours' || r.unit === 'days' ? r.unit : 'hours'
      const max = unit === 'minutes' ? 10080 : unit === 'hours' ? 8760 : 365
      return { every: clampInt(r.every ?? 1, 1, max, 1), unit }
    }
    case 'cron':
      return { expr: typeof r.expr === 'string' ? r.expr.trim().slice(0, 120) : '0 9 * * *' }
  }
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Coerce an untrusted draft into a safe, persistable shape (clamps + defaults). */
export function normaliseDraft(raw: Partial<AutomationDraft>): AutomationDraft {
  const action_type = isActionType(raw.action_type) ? raw.action_type : 'announcement'
  const schedule_type = isScheduleType(raw.schedule_type) ? raw.schedule_type : 'daily'
  const conditionsRaw = (raw.conditions ?? {}) as Conditions
  const conditions: Conditions = {}
  if (conditionsRaw.min_members != null) conditions.min_members = clampInt(conditionsRaw.min_members, 0, 100_000_000, 0)
  if (conditionsRaw.max_members != null) conditions.max_members = clampInt(conditionsRaw.max_members, 0, 100_000_000, 0)
  return {
    id: raw.id,
    name: (raw.name ?? '').trim().slice(0, 100) || 'Untitled workflow',
    enabled: raw.enabled ?? true,
    action_type,
    action_config: normaliseActionConfig(action_type, raw.action_config ?? {}),
    schedule_type,
    schedule_config: normaliseScheduleConfig(schedule_type, raw.schedule_config ?? {}),
    timezone: isValidTimezone(raw.timezone) ? raw.timezone : 'UTC',
    conditions,
    cooldown_minutes: clampInt(raw.cooldown_minutes ?? 0, 0, 525_600, 0),
    max_retries: clampInt(raw.max_retries ?? 0, 0, 5, 0),
  }
}

/** Keep only the fields the action type declares, coercing numbers + strings. */
export function normaliseActionConfig(type: ActionType, raw: unknown): Record<string, unknown> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const f of ACTION_BY_TYPE[type].fields) {
    const v = r[f.key]
    if (f.kind === 'number') {
      out[f.key] = clampInt(v ?? f.default ?? 0, f.min ?? 0, f.max ?? 1_000_000, Number(f.default ?? 0))
    } else if (f.kind === 'select') {
      const allowed = (f.options ?? []).map((o) => o.value)
      out[f.key] = allowed.includes(String(v)) ? String(v) : String(f.default ?? allowed[0] ?? '')
    } else if (typeof v === 'string') {
      out[f.key] = v.slice(0, f.kind === 'message' ? 4000 : 200)
    } else if (f.default !== undefined) {
      out[f.key] = f.default
    }
  }
  return out
}

// ── Validation ────────────────────────────────────────────────────────────────

/** Returns a human-readable error string, or null when the draft is valid. */
export function validateDraft(draft: AutomationDraft): string | null {
  if (!draft.name.trim()) return 'Give your workflow a name.'

  // Required action fields present?
  const def = ACTION_BY_TYPE[draft.action_type]
  for (const f of def.fields) {
    if (!f.required) continue
    const v = draft.action_config[f.key]
    if (v === undefined || v === null || String(v).trim() === '') {
      return `${def.label}: "${f.label}" is required.`
    }
  }
  // Conditional requirement: inactivity remove_role needs a role.
  if (
    draft.action_type === 'inactivity_cleanup' &&
    draft.action_config.mode === 'remove_role' &&
    !String(draft.action_config.role_id ?? '').trim()
  ) {
    return 'Inactivity Report: choose the role to remove, or switch to report-only.'
  }

  // Schedule validity.
  switch (draft.schedule_type) {
    case 'weekly':
      if (!draft.schedule_config.days || draft.schedule_config.days.length === 0)
        return 'Weekly schedule: pick at least one weekday.'
      break
    case 'interval':
      if (!draft.schedule_config.every || draft.schedule_config.every < 1)
        return 'Interval schedule: the interval must be at least 1.'
      break
    case 'cron':
      if (!isValidCron(draft.schedule_config.expr ?? ''))
        return 'Cron schedule: enter a valid 5-field expression, e.g. "0 9 * * 1-5".'
      break
  }

  if (draft.conditions.min_members != null && draft.conditions.max_members != null) {
    if (draft.conditions.min_members > draft.conditions.max_members)
      return 'Conditions: minimum members cannot exceed maximum members.'
  }
  return null
}

// ── Cron parsing (standard 5-field: minute hour day-of-month month day-of-week) ─

type CronField = { min: number; max: number }
const CRON_FIELDS: CronField[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // day of week (0/7 = Sunday)
]

/** Parse one cron field into the set of integers it matches, or null if invalid. */
function parseCronField(token: string, field: CronField): Set<number> | null {
  const out = new Set<number>()
  for (const part of token.split(',')) {
    let range = part
    let step = 1
    const slash = part.split('/')
    if (slash.length === 2) {
      range = slash[0]
      step = Number(slash[1])
      if (!Number.isInteger(step) || step < 1) return null
    } else if (slash.length > 2) {
      return null
    }
    let lo: number
    let hi: number
    if (range === '*') {
      lo = field.min
      hi = field.max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-')
      lo = Number(a)
      hi = Number(b)
    } else {
      lo = Number(range)
      hi = Number(range)
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null
    // Normalise Sunday-as-7 for the day-of-week field.
    if (field.max === 6) {
      if (lo === 7) lo = 0
      if (hi === 7) hi = 0
    }
    if (lo > hi || lo < field.min || hi > field.max) return null
    for (let i = lo; i <= hi; i += step) out.add(i)
  }
  return out.size ? out : null
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null
}

type ParsedCron = { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number> }

export function parseCron(expr: string): ParsedCron | null {
  const tokens = expr.trim().split(/\s+/)
  if (tokens.length !== 5) return null
  const sets = tokens.map((t, i) => parseCronField(t, CRON_FIELDS[i]))
  if (sets.some((s) => s === null)) return null
  return {
    minute: sets[0]!,
    hour: sets[1]!,
    dom: sets[2]!,
    month: sets[3]!,
    dow: sets[4]!,
  }
}

// ── Timezone-aware time maths ──────────────────────────────────────────────────
// These mirror the helpers in pulse-bot/src/scheduler.js. The two must agree so
// the dashboard's "next run" preview matches when the bot actually fires.

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Wall-clock parts of `date` as observed in `timeZone`. */
function getLocalParts(date: Date, timeZone: string): LocalParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: WEEKDAY_INDEX[map.weekday] ?? 0,
  }
}

/** Offset (ms) added to a UTC instant to get the wall clock in `timeZone`. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  )
  return asUTC - date.getTime()
}

/** The UTC instant for a given wall-clock time in `timeZone`. Handles DST. */
function localToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const offset = tzOffsetMs(new Date(guess), timeZone)
  let utc = guess - offset
  // One correction pass resolves DST transitions where the offset at the guess
  // differs from the offset at the resolved instant.
  const offset2 = tzOffsetMs(new Date(utc), timeZone)
  if (offset2 !== offset) utc = guess - offset2
  return new Date(utc)
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function parseHM(time: string): { h: number; m: number } {
  const [h, m] = normaliseTime(time).split(':').map(Number)
  return { h, m }
}

/**
 * Compute the next fire time (UTC) strictly after `from`, or null if none in a
 * year. Daily/weekly/monthly resolve their wall-clock time in `timezone`;
 * interval is relative to `from`; cron is matched minute-by-minute in `timezone`.
 */
export function computeNextRun(
  type: ScheduleType,
  config: ScheduleConfig,
  timezone: string,
  from: Date = new Date(),
): Date | null {
  const tz = isValidTimezone(timezone) ? timezone : 'UTC'

  if (type === 'interval') {
    const every = Math.max(1, config.every ?? 1)
    const unitMs = config.unit === 'minutes' ? 60_000 : config.unit === 'days' ? 86_400_000 : 3_600_000
    return new Date(from.getTime() + every * unitMs)
  }

  if (type === 'cron') {
    const parsed = parseCron(config.expr ?? '')
    if (!parsed) return null
    // Scan minute-by-minute from the next whole minute. Capped at ~366 days.
    let cursor = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000
    const limit = cursor + 367 * 86_400_000
    while (cursor <= limit) {
      const p = getLocalParts(new Date(cursor), tz)
      // Cron day-of-month and day-of-week are OR'd when both are restricted
      // (standard Vixie cron behaviour).
      const domRestricted = !(parsed.dom.size === 31)
      const dowRestricted = !(parsed.dow.size === 7)
      const domOk = parsed.dom.has(p.day)
      const dowOk = parsed.dow.has(p.weekday)
      const dayOk =
        domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk
      if (parsed.minute.has(p.minute) && parsed.hour.has(p.hour) && parsed.month.has(p.month) && dayOk) {
        return new Date(cursor)
      }
      cursor += 60_000
    }
    return null
  }

  // daily / weekly / monthly — iterate candidate local calendar days.
  const { h, m } = parseHM(config.time ?? '09:00')
  const base = getLocalParts(from, tz)
  for (let offset = 0; offset <= 400; offset++) {
    // Normalise the local calendar date `base + offset` days via UTC maths.
    const d = new Date(Date.UTC(base.year, base.month - 1, base.day + offset))
    const y = d.getUTCFullYear()
    const mo = d.getUTCMonth() + 1
    const day = d.getUTCDate()
    const weekday = d.getUTCDay()

    if (type === 'weekly') {
      const days = config.days ?? [1]
      if (!days.includes(weekday)) continue
    } else if (type === 'monthly') {
      const wanted = Math.min(config.day ?? 1, daysInMonth(y, mo))
      if (day !== wanted) continue
    }

    const candidate = localToUtc(y, mo, day, h, m, tz)
    if (candidate.getTime() > from.getTime()) return candidate
  }
  return null
}

// ── Human-readable schedule description ────────────────────────────────────────

// Times are always the viewer's local wall-clock (the timezone is captured
// automatically), so we describe the schedule without a timezone suffix.
export function describeSchedule(type: ScheduleType, config: ScheduleConfig): string {
  switch (type) {
    case 'daily':
      return `Daily at ${normaliseTime(config.time ?? '09:00')}`
    case 'weekly': {
      const days = (config.days ?? []).map((d) => WEEKDAY_LABELS[d]).join(', ')
      return `Weekly on ${days || '—'} at ${normaliseTime(config.time ?? '09:00')}`
    }
    case 'monthly':
      return `Monthly on day ${config.day ?? 1} at ${normaliseTime(config.time ?? '09:00')}`
    case 'interval': {
      const every = config.every ?? 1
      const unit = config.unit ?? 'hours'
      const unitLabel = every === 1 ? unit.replace(/s$/, '') : unit
      return `Every ${every} ${unitLabel}`
    }
    case 'cron':
      return `Cron: ${config.expr ?? ''}`
  }
}

/** Compact, human relative description of when something next/last happened. */
export function relativeTimeLabel(iso: string | null, opts: { future?: boolean } = {}): string {
  if (!iso) return '—'
  const target = new Date(iso).getTime()
  const now = Date.now()
  const diff = opts.future ? target - now : now - target
  const abs = Math.abs(diff)
  const s = Math.floor(abs / 1000)
  if (diff < 0 && opts.future) return 'due now'
  if (s < 60) return opts.future ? `in ${s}s` : `${s}s ago`
  const mi = Math.floor(s / 60)
  if (mi < 60) return opts.future ? `in ${mi}m` : `${mi}m ago`
  const hr = Math.floor(mi / 60)
  if (hr < 24) return opts.future ? `in ${hr}h` : `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 30) return opts.future ? `in ${d}d` : `${d}d ago`
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ── Presets / templates ────────────────────────────────────────────────────────

export type AutomationPreset = {
  id: string
  name: string
  description: string
  icon: string
  draft: Omit<AutomationDraft, 'name'> & { name: string }
}

export const AUTOMATION_PRESETS: AutomationPreset[] = [
  {
    id: 'daily-standup',
    name: 'Daily good-morning post',
    description: 'Greets the server every morning at 9am in a channel of your choice.',
    icon: 'Megaphone',
    draft: {
      name: 'Daily good-morning',
      enabled: true,
      action_type: 'announcement',
      action_config: { channel_id: '', message: 'Good morning, {server}! ☀️ Have a great day.', mention: 'none' },
      schedule_type: 'daily',
      schedule_config: { time: '09:00' },
      timezone: 'UTC',
      conditions: {},
      cooldown_minutes: 0,
      max_retries: 1,
    },
  },
  {
    id: 'weekly-rules-reminder',
    name: 'Weekly rules reminder',
    description: 'Posts a reminder to read the rules every Monday morning.',
    icon: 'BellRing',
    draft: {
      name: 'Weekly rules reminder',
      enabled: true,
      action_type: 'welcome_reminder',
      action_config: { channel_id: '', message: '📜 Reminder: please review the server rules. Thanks for keeping {server} friendly!' },
      schedule_type: 'weekly',
      schedule_config: { time: '10:00', days: [1] },
      timezone: 'UTC',
      conditions: {},
      cooldown_minutes: 0,
      max_retries: 1,
    },
  },
  {
    id: 'weekly-analytics',
    name: 'Weekly activity digest',
    description: 'Posts a 7-day activity summary every Sunday evening.',
    icon: 'BarChart3',
    draft: {
      name: 'Weekly activity digest',
      enabled: true,
      action_type: 'analytics_summary',
      action_config: { channel_id: '', period: '7d' },
      schedule_type: 'weekly',
      schedule_config: { time: '18:00', days: [0] },
      timezone: 'UTC',
      conditions: {},
      cooldown_minutes: 0,
      max_retries: 1,
    },
  },
  {
    id: 'nightly-lock',
    name: 'Nightly channel quiet hours',
    description: 'Locks a channel at night and unlocks it in the morning (create both halves).',
    icon: 'Lock',
    draft: {
      name: 'Lock #general overnight',
      enabled: true,
      action_type: 'scheduled_moderation',
      action_config: { channel_id: '', operation: 'lock', slowmode_seconds: 0 },
      schedule_type: 'daily',
      schedule_config: { time: '23:00' },
      timezone: 'UTC',
      conditions: {},
      cooldown_minutes: 0,
      max_retries: 0,
    },
  },
  {
    id: 'daily-role-cleanup',
    name: 'Daily temporary-role cleanup',
    description: 'Clears a temporary role (event/daily) from everyone each night.',
    icon: 'Timer',
    draft: {
      name: 'Clear daily role',
      enabled: true,
      action_type: 'temp_role_removal',
      action_config: { role_id: '' },
      schedule_type: 'daily',
      schedule_config: { time: '00:00' },
      timezone: 'UTC',
      conditions: {},
      cooldown_minutes: 0,
      max_retries: 0,
    },
  },
  {
    id: 'monthly-inactivity',
    name: 'Monthly inactivity report',
    description: 'Reports members with no activity in 30 days on the 1st of each month.',
    icon: 'UserMinus',
    draft: {
      name: 'Monthly inactivity report',
      enabled: true,
      action_type: 'inactivity_cleanup',
      action_config: { inactive_days: 30, channel_id: '', mode: 'report', role_id: '' },
      schedule_type: 'monthly',
      schedule_config: { time: '08:00', day: 1 },
      timezone: 'UTC',
      conditions: {},
      cooldown_minutes: 0,
      max_retries: 0,
    },
  },
]
