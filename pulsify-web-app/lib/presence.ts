// Custom Bot Status & Presence Management catalog + pure helpers (PULSIFY-30).
//
// No JSX / framework / IO imports live here: icons are referenced by lucide
// NAME (resolved in the UI layer), exactly like lib/giveaways.ts, lib/tickets.ts
// and lib/automations.ts. A Discord bot has ONE global presence, so this is
// modelled as a per-guild config (guild_presence) plus a single global pointer
// (bot_presence_state.active_guild_id) naming the guild whose config currently
// drives the bot. The dashboard edits the config; the BOT
// (pulse-bot/src/presence.js) resolves the dynamic placeholders and calls
// client.user.setPresence(). The status model, placeholder swap and config
// normalisation MUST agree between the two — keep this in sync with presence.js
// the same way lib/giveaways.ts ↔ giveaways.js are.

// ── Status ──────────────────────────────────────────────────────────────────

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible'

export const STATUS_OPTIONS: {
  value: PresenceStatus
  label: string
  /** Discord status dot colour, reused by the preview card. */
  color: string
}[] = [
  { value: 'online', label: 'Online', color: '#23a55a' },
  { value: 'idle', label: 'Idle', color: '#f0b232' },
  { value: 'dnd', label: 'Do Not Disturb', color: '#f23f43' },
  { value: 'invisible', label: 'Invisible', color: '#80848e' },
]

export function normaliseStatus(v: unknown): PresenceStatus {
  return v === 'online' || v === 'idle' || v === 'dnd' || v === 'invisible'
    ? v
    : 'online'
}

// ── Activity kinds ──────────────────────────────────────────────────────────
// `verb` is the word Discord prefixes the activity with in the client
// ("Playing X", "Watching X"). `custom` shows the raw text with no verb.

export type ActivityKind =
  | 'playing'
  | 'watching'
  | 'listening'
  | 'competing'
  | 'streaming'
  | 'custom'

export const ACTIVITY_KINDS: {
  value: ActivityKind
  label: string
  /** Prefix shown before the text in the Discord client ('' for custom). */
  verb: string
  icon: string
}[] = [
  { value: 'playing', label: 'Playing', verb: 'Playing', icon: 'Gamepad2' },
  { value: 'watching', label: 'Watching', verb: 'Watching', icon: 'Eye' },
  { value: 'listening', label: 'Listening to', verb: 'Listening to', icon: 'Headphones' },
  { value: 'competing', label: 'Competing in', verb: 'Competing in', icon: 'Trophy' },
  { value: 'streaming', label: 'Streaming', verb: 'Streaming', icon: 'Radio' },
  { value: 'custom', label: 'Custom', verb: '', icon: 'Sparkles' },
]

export function normaliseKind(v: unknown): ActivityKind {
  return ACTIVITY_KINDS.some((k) => k.value === v) ? (v as ActivityKind) : 'playing'
}

export function activityVerb(kind: ActivityKind): string {
  return ACTIVITY_KINDS.find((k) => k.value === kind)?.verb ?? ''
}

// ── Dynamic placeholders ────────────────────────────────────────────────────
// Tokens swapped into activity text by the bot using live data. They reflect
// the ACTIVE guild (and bot-wide for {servers}/{uptime}) — see presence.js.

export type PresenceVars = {
  servers: number
  members: number
  tickets: number
  giveaways: number
  mod_actions: number
  uptime: string
}

export const PLACEHOLDERS: {
  token: string
  key: keyof PresenceVars
  label: string
  description: string
  sample: string
}[] = [
  { token: '{servers}', key: 'servers', label: 'Server count', description: 'Total servers Pulse is in', sample: '142' },
  { token: '{members}', key: 'members', label: 'Member count', description: 'Members in the active server', sample: '3,204' },
  { token: '{tickets}', key: 'tickets', label: 'Active tickets', description: 'Open tickets in the active server', sample: '7' },
  { token: '{giveaways}', key: 'giveaways', label: 'Active giveaways', description: 'Running giveaways in the active server', sample: '2' },
  { token: '{mod_actions}', key: 'mod_actions', label: 'Mod actions (24h)', description: 'Moderation actions in the last 24h', sample: '18' },
  { token: '{uptime}', key: 'uptime', label: 'Uptime', description: 'How long Pulse has been online', sample: '3d 4h' },
]

const SAMPLE_VARS: PresenceVars = {
  servers: 142,
  members: 3204,
  tickets: 7,
  giveaways: 2,
  mod_actions: 18,
  uptime: '3d 4h',
}

/** Format a numeric placeholder value with thousands separators. */
function fmtNum(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0'
}

/**
 * Swap {token} placeholders in `text` for live values. Unknown tokens are left
 * untouched. MIRRORED in pulse-bot/src/presence.js — keep in sync.
 */
export function resolvePlaceholders(text: string, vars: Partial<PresenceVars>): string {
  if (!text) return ''
  return text.replace(/\{(servers|members|tickets|giveaways|mod_actions|uptime)\}/g, (_m, key) => {
    const v = (vars as Record<string, unknown>)[key]
    if (v == null) return ''
    return typeof v === 'number' ? fmtNum(v) : String(v)
  })
}

/** Preview helper: resolve against representative sample values for the editor. */
export function resolveSample(text: string): string {
  return resolvePlaceholders(text, SAMPLE_VARS)
}

// ── Limits ──────────────────────────────────────────────────────────────────

export const PRESENCE_LIMITS = {
  maxActivities: 10,
  minIntervalSeconds: 15,
  maxIntervalSeconds: 3600,
  maxTextLength: 128,
  maxSchedules: 10,
} as const

// ── Types ───────────────────────────────────────────────────────────────────

export type PresenceActivity = {
  kind: ActivityKind
  text: string
  /** Optional leading emoji (unicode or :name:) shown before the text. */
  emoji?: string
  /** Twitch/YouTube URL — only meaningful when kind === 'streaming'. */
  stream_url?: string
}

export type PresenceSchedule = {
  /** Days of week the window applies to (0 = Sunday … 6 = Saturday). */
  days: number[]
  /** UTC window, 'HH:MM'. */
  start: string
  end: string
  activity: PresenceActivity
}

export type GuildPresenceConfig = {
  guildId: string
  enabled: boolean
  status: PresenceStatus
  activities: PresenceActivity[]
  rotationEnabled: boolean
  rotationIntervalSeconds: number
  schedules: PresenceSchedule[]
  maintenanceMode: boolean
  maintenanceText: string
  updatedAt: string | null
  updatedBy: string | null
}

/** Wire shape used by both server actions and the client editor. */
export type PresenceDraft = {
  enabled: boolean
  status: PresenceStatus
  activities: PresenceActivity[]
  rotationEnabled: boolean
  rotationIntervalSeconds: number
  schedules: PresenceSchedule[]
  maintenanceMode: boolean
  maintenanceText: string
}

export type PresenceStateRow = {
  activeGuildId: string | null
  updatedAt: string | null
  updatedBy: string | null
}

// The bot's default presence when no guild is active / config is empty. Matches
// the historic hardcoded value so removing the active pointer reverts cleanly.
export const DEFAULT_PRESENCE = {
  status: 'online' as PresenceStatus,
  kind: 'playing' as ActivityKind,
  text: 'Powered by Pulsify',
}

export const MAINTENANCE_DEFAULT_TEXT = '🔧 Under maintenance — back soon'

// ── Normalisation ───────────────────────────────────────────────────────────

function clampInterval(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return 30
  return Math.max(PRESENCE_LIMITS.minIntervalSeconds, Math.min(PRESENCE_LIMITS.maxIntervalSeconds, Math.round(v)))
}

function normaliseActivity(raw: unknown): PresenceActivity | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const text = typeof r.text === 'string' ? r.text.slice(0, PRESENCE_LIMITS.maxTextLength) : ''
  const kind = normaliseKind(r.kind)
  if (!text && kind !== 'custom') return null
  const activity: PresenceActivity = { kind, text }
  if (typeof r.emoji === 'string' && r.emoji.trim()) activity.emoji = r.emoji.trim().slice(0, 64)
  if (typeof r.stream_url === 'string' && r.stream_url.trim()) activity.stream_url = r.stream_url.trim()
  return activity
}

function normaliseSchedule(raw: unknown): PresenceSchedule | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const activity = normaliseActivity(r.activity)
  if (!activity) return null
  const days = Array.isArray(r.days)
    ? [...new Set(r.days.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6))]
    : []
  return {
    days,
    start: normaliseTime(r.start),
    end: normaliseTime(r.end),
    activity,
  }
}

/** 'HH:MM' guard — mirrors the scheduler's normaliseTime. */
export function normaliseTime(v: unknown): string {
  if (typeof v !== 'string') return '00:00'
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return '00:00'
  const h = Math.max(0, Math.min(23, Number(m[1])))
  const mi = Math.max(0, Math.min(59, Number(m[2])))
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

/**
 * Build a typed config from a raw DB row. MIRRORED in presence.js — keep the
 * defaults and field names in sync. Tolerant of a null row (returns defaults).
 */
export function normalisePresenceConfig(
  row: Record<string, unknown> | null,
  guildId: string,
): GuildPresenceConfig {
  const activities = Array.isArray(row?.activities)
    ? (row!.activities as unknown[]).map(normaliseActivity).filter((a): a is PresenceActivity => a !== null)
    : []
  const schedules = Array.isArray(row?.schedules)
    ? (row!.schedules as unknown[]).map(normaliseSchedule).filter((s): s is PresenceSchedule => s !== null)
    : []
  return {
    guildId,
    enabled: row?.enabled === true,
    status: normaliseStatus(row?.status),
    activities: activities.slice(0, PRESENCE_LIMITS.maxActivities),
    rotationEnabled: row?.rotation_enabled !== false,
    rotationIntervalSeconds: clampInterval(row?.rotation_interval_seconds ?? 30),
    schedules: schedules.slice(0, PRESENCE_LIMITS.maxSchedules),
    maintenanceMode: row?.maintenance_mode === true,
    maintenanceText: typeof row?.maintenance_text === 'string' ? row.maintenance_text : '',
    updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : null,
    updatedBy: typeof row?.updated_by === 'string' ? row.updated_by : null,
  }
}

export function configToDraft(config: GuildPresenceConfig): PresenceDraft {
  return {
    enabled: config.enabled,
    status: config.status,
    activities: config.activities,
    rotationEnabled: config.rotationEnabled,
    rotationIntervalSeconds: config.rotationIntervalSeconds,
    schedules: config.schedules,
    maintenanceMode: config.maintenanceMode,
    maintenanceText: config.maintenanceText,
  }
}

export function emptyDraft(): PresenceDraft {
  return {
    enabled: false,
    status: 'online',
    activities: [{ kind: 'playing', text: DEFAULT_PRESENCE.text }],
    rotationEnabled: true,
    rotationIntervalSeconds: 30,
    schedules: [],
    maintenanceMode: false,
    maintenanceText: '',
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

/** Returns a human error string, or null when the draft is valid. */
export function validatePresenceDraft(draft: PresenceDraft): string | null {
  if (!draft.maintenanceMode && draft.activities.length === 0) {
    return 'Add at least one activity (or enable maintenance mode).'
  }
  if (draft.activities.length > PRESENCE_LIMITS.maxActivities) {
    return `You can have at most ${PRESENCE_LIMITS.maxActivities} activities.`
  }
  for (const a of draft.activities) {
    if (a.kind !== 'custom' && !a.text.trim()) {
      return 'Every activity needs text.'
    }
    if (a.text.length > PRESENCE_LIMITS.maxTextLength) {
      return `Activity text must be ${PRESENCE_LIMITS.maxTextLength} characters or fewer.`
    }
    if (a.kind === 'streaming' && a.stream_url && !/^https?:\/\//i.test(a.stream_url)) {
      return 'Streaming activities need a valid http(s) stream URL.'
    }
  }
  if (
    draft.rotationIntervalSeconds < PRESENCE_LIMITS.minIntervalSeconds ||
    draft.rotationIntervalSeconds > PRESENCE_LIMITS.maxIntervalSeconds
  ) {
    return `Rotation interval must be between ${PRESENCE_LIMITS.minIntervalSeconds}s and ${PRESENCE_LIMITS.maxIntervalSeconds}s.`
  }
  if (draft.maintenanceMode && draft.maintenanceText.length > PRESENCE_LIMITS.maxTextLength) {
    return `Maintenance text must be ${PRESENCE_LIMITS.maxTextLength} characters or fewer.`
  }
  return null
}

/** Map a draft to the DB column shape for an upsert. */
export function draftToRow(draft: PresenceDraft): Record<string, unknown> {
  return {
    enabled: draft.enabled,
    status: draft.status,
    activities: draft.activities,
    rotation_enabled: draft.rotationEnabled,
    rotation_interval_seconds: draft.rotationIntervalSeconds,
    schedules: draft.schedules,
    maintenance_mode: draft.maintenanceMode,
    maintenance_text: draft.maintenanceText || null,
  }
}

// ── Preview formatting ──────────────────────────────────────────────────────

/**
 * Render the single line the Discord client shows for an activity, with
 * placeholders resolved. Used by the live preview card.
 */
export function formatActivityLine(activity: PresenceActivity, vars: Partial<PresenceVars>): string {
  const text = resolvePlaceholders(activity.text, vars)
  const emoji = activity.emoji ? `${activity.emoji} ` : ''
  if (activity.kind === 'custom') return `${emoji}${text}`.trim()
  const verb = activityVerb(activity.kind)
  return `${verb} ${emoji}${text}`.trim()
}

// ── Presets ─────────────────────────────────────────────────────────────────
// Quick-fill templates. Applying a preset replaces the activity list (and, for
// maintenance, the toggle). Covers the task's "Pulse Guard presence presets"
// and "event-based temporary statuses" as ready-made starting points.

export type PresencePreset = {
  id: string
  label: string
  description: string
  icon: string
  apply: Partial<PresenceDraft>
}

export const PRESENCE_PRESETS: PresencePreset[] = [
  {
    id: 'branding',
    label: 'Branding',
    description: 'Rotating Pulse branding + live server/member counts.',
    icon: 'Sparkles',
    apply: {
      status: 'online',
      rotationEnabled: true,
      rotationIntervalSeconds: 30,
      maintenanceMode: false,
      activities: [
        { kind: 'watching', text: '{members} members' },
        { kind: 'playing', text: 'across {servers} servers' },
        { kind: 'listening', text: '/help' },
      ],
    },
  },
  {
    id: 'pulse-guard',
    label: 'Pulse Guard',
    description: 'Security-forward presence highlighting moderation.',
    icon: 'ShieldAlert',
    apply: {
      status: 'dnd',
      rotationEnabled: true,
      rotationIntervalSeconds: 30,
      maintenanceMode: false,
      activities: [
        { kind: 'watching', text: 'over {members} members 🛡️' },
        { kind: 'playing', text: '{mod_actions} actions today' },
        { kind: 'custom', text: 'Pulse Guard active', emoji: '🛡️' },
      ],
    },
  },
  {
    id: 'community',
    label: 'Community',
    description: 'Engagement-focused — giveaways, tickets, support.',
    icon: 'Users',
    apply: {
      status: 'online',
      rotationEnabled: true,
      rotationIntervalSeconds: 25,
      maintenanceMode: false,
      activities: [
        { kind: 'playing', text: '{giveaways} giveaways live 🎉' },
        { kind: 'listening', text: '{tickets} open tickets' },
        { kind: 'watching', text: 'the community grow' },
      ],
    },
  },
  {
    id: 'event',
    label: 'Live Event',
    description: 'Temporary hype status for a server event.',
    icon: 'CalendarClock',
    apply: {
      status: 'idle',
      rotationEnabled: false,
      maintenanceMode: false,
      activities: [{ kind: 'competing', text: 'a live event 🎊' }],
    },
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    description: 'Signal downtime with a Do-Not-Disturb status.',
    icon: 'Wrench',
    apply: {
      maintenanceMode: true,
      maintenanceText: MAINTENANCE_DEFAULT_TEXT,
      status: 'dnd',
    },
  },
]
