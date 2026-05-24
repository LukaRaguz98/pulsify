// Ticket System catalog + pure helpers (PULSIFY-22).
//
// No JSX / framework / IO imports live here: icons are referenced by lucide
// NAME (resolved in the UI layer), exactly like lib/insights.ts,
// lib/automations.ts and lib/command-palette.ts. That keeps this module
// trivially testable and lets the bot mirror the same shapes in plain JS
// (pulse-bot/src/tickets.js). The dashboard and the bot both read/write the
// `ticket_configs` / `tickets` / `ticket_events` tables, so the type catalog,
// channel-naming and validation rules MUST agree between the two — keep them in
// sync the same way lib/automations.ts ↔ scheduler.js are.

// ── Statuses ──────────────────────────────────────────────────────────────────

export type TicketStatus = 'open' | 'claimed' | 'closed'

export const STATUS_META: Record<
  TicketStatus,
  { label: string; icon: string; color: string; order: number }
> = {
  open:    { label: 'Open',    icon: 'CircleDot',    color: '#22c55e', order: 0 },
  claimed: { label: 'Claimed', icon: 'UserCheck',    color: '#3b82f6', order: 1 },
  closed:  { label: 'Closed',  icon: 'CheckCircle2', color: '#94a3b8', order: 2 },
}

/** A ticket counts as "active" (still needs attention) while not closed. */
export function isActiveStatus(status: string): boolean {
  return status === 'open' || status === 'claimed'
}

// ── Priorities ────────────────────────────────────────────────────────────────

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'

export const PRIORITY_META: Record<
  TicketPriority,
  { label: string; icon: string; color: string; order: number }
> = {
  low:    { label: 'Low',    icon: 'ChevronDown',  color: '#94a3b8', order: 0 },
  normal: { label: 'Normal', icon: 'Minus',        color: '#3b82f6', order: 1 },
  high:   { label: 'High',   icon: 'ChevronUp',    color: '#f59e0b', order: 2 },
  urgent: { label: 'Urgent', icon: 'AlertOctagon', color: '#ef4444', order: 3 },
}

export const PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent']

export function normalisePriority(v: unknown): TicketPriority {
  return PRIORITIES.includes(v as TicketPriority) ? (v as TicketPriority) : 'normal'
}

export function normaliseStatus(v: unknown): TicketStatus {
  return v === 'open' || v === 'claimed' || v === 'closed' ? v : 'open'
}

// ── Timeline / audit event types ──────────────────────────────────────────────

export type TicketEventType =
  | 'opened'
  | 'claimed'
  | 'unclaimed'
  | 'assigned'
  | 'closed'
  | 'reopened'
  | 'renamed'
  | 'user_added'
  | 'user_removed'
  | 'priority_changed'
  | 'note'
  | 'deleted'
  | 'panel_posted'

export const EVENT_META: Record<
  TicketEventType,
  { label: string; icon: string; accent: string }
> = {
  opened:           { label: 'Opened',            icon: 'Ticket',       accent: '#22c55e' },
  claimed:          { label: 'Claimed',           icon: 'Hand',         accent: '#3b82f6' },
  unclaimed:        { label: 'Unclaimed',         icon: 'Undo2',        accent: '#94a3b8' },
  assigned:         { label: 'Assigned',          icon: 'UserCheck',    accent: '#3b82f6' },
  closed:           { label: 'Closed',            icon: 'CheckCircle2', accent: '#94a3b8' },
  reopened:         { label: 'Reopened',          icon: 'RotateCcw',    accent: '#22c55e' },
  renamed:          { label: 'Renamed',           icon: 'PenLine',      accent: '#a855f7' },
  user_added:       { label: 'User added',        icon: 'UserPlus',     accent: '#3b82f6' },
  user_removed:     { label: 'User removed',      icon: 'UserMinus',    accent: '#f59e0b' },
  priority_changed: { label: 'Priority changed',  icon: 'Flag',         accent: '#f59e0b' },
  note:             { label: 'Note',              icon: 'StickyNote',   accent: '#a855f7' },
  deleted:          { label: 'Deleted',           icon: 'Trash2',       accent: '#ef4444' },
  panel_posted:     { label: 'Panel posted',      icon: 'LayoutPanelTop', accent: '#a855f7' },
}

// ── Forms ──────────────────────────────────────────────────────────────────────

export type FormFieldStyle = 'short' | 'paragraph'

export type TicketFormField = {
  id: string
  label: string
  style: FormFieldStyle
  required: boolean
  placeholder?: string
  /** Discord text-input max (modal limit is 4000; we cap shorter for UX). */
  max_length?: number
}

// ── Ticket types ────────────────────────────────────────────────────────────────

export type TicketType = {
  id: string
  label: string
  /** Single emoji shown on the panel button / select option. */
  emoji?: string
  description?: string
  /** Hex accent for the open-ticket embed; falls back to the panel colour. */
  color?: string
  enabled: boolean
  /** Optional per-type category override (else config.category_id). */
  category_id?: string | null
  /** Optional per-type support roles (merged with config.support_role_ids). */
  support_role_ids?: string[]
  /** Up to TICKET_LIMITS.maxFormFields questions asked in a modal on open. */
  form: TicketFormField[]
}

// The starter catalog an admin sees on first setup — the categories named in the
// spec (support / bug reports / moderation reports / partnership / applications)
// plus room for custom types. Emoji + colour give the panel instant polish.
export const DEFAULT_TICKET_TYPES: TicketType[] = [
  {
    id: 'support', label: 'General Support', emoji: '🎫', color: '#5865f2', enabled: true,
    description: 'Questions, help and general assistance.',
    form: [
      { id: 'subject', label: 'What do you need help with?', style: 'short', required: true, placeholder: 'Short summary', max_length: 100 },
      { id: 'details', label: 'Describe your issue', style: 'paragraph', required: true, placeholder: 'Give us as much detail as you can', max_length: 1000 },
    ],
  },
  {
    id: 'bug', label: 'Bug Report', emoji: '🐞', color: '#ef4444', enabled: true,
    description: 'Report something that isn’t working.',
    form: [
      { id: 'summary', label: 'What’s broken?', style: 'short', required: true, max_length: 100 },
      { id: 'steps', label: 'Steps to reproduce', style: 'paragraph', required: true, max_length: 1000 },
    ],
  },
  {
    id: 'report', label: 'Moderation Report', emoji: '🚨', color: '#f59e0b', enabled: true,
    description: 'Report a member or rule violation.',
    form: [
      { id: 'who', label: 'Who are you reporting?', style: 'short', required: true, max_length: 100 },
      { id: 'what', label: 'What happened?', style: 'paragraph', required: true, max_length: 1000 },
    ],
  },
  {
    id: 'partnership', label: 'Partnership', emoji: '🤝', color: '#a855f7', enabled: false,
    description: 'Propose a partnership or collaboration.',
    form: [
      { id: 'server', label: 'Your server / project', style: 'short', required: true, max_length: 100 },
      { id: 'pitch', label: 'Your proposal', style: 'paragraph', required: true, max_length: 1000 },
    ],
  },
  {
    id: 'application', label: 'Application', emoji: '📝', color: '#22c55e', enabled: false,
    description: 'Apply for a role or position.',
    form: [
      { id: 'role', label: 'What are you applying for?', style: 'short', required: true, max_length: 100 },
      { id: 'why', label: 'Why should we pick you?', style: 'paragraph', required: true, max_length: 1000 },
    ],
  },
]

// ── Interaction custom_ids (shared with pulse-bot/src/tickets.js) ────────────
// The dashboard posts the panel; the BOT handles the clicks. Both sides must
// agree on these id strings — keep them identical to pulse-bot/src/tickets.js.

export const TKT = 'tkt'
/** Panel button that opens a ticket of a given type. */
export const openCustomId = (typeId: string) => `${TKT}:open:${typeId}`
/** Panel string-select (dropdown mode) — values are type ids. */
export const SELECT_CUSTOM_ID = `${TKT}:menu`
/** In-channel control buttons (carry the ticket id). */
export const claimCustomId = (ticketId: string) => `${TKT}:claim:${ticketId}`
export const closeCustomId = (ticketId: string) => `${TKT}:close:${ticketId}`

// ── Discord channel permission bits (for ticket channel overwrites) ──────────
// Stored as decimal strings — the format Discord's permission-overwrite API
// expects. Used by the dashboard actions; the bot uses discord.js flag enums.
const VIEW = 1n << 10n
const SEND = 1n << 11n
const EMBED = 1n << 14n
const ATTACH = 1n << 15n
const HISTORY = 1n << 16n
/** Full participant access: see + talk + attach + read history. */
export const TICKET_MEMBER_ALLOW = (VIEW | SEND | EMBED | ATTACH | HISTORY).toString()
/** Read-only access used when a ticket is closed (locked). */
export const TICKET_READONLY_ALLOW = (VIEW | HISTORY).toString()
export const TICKET_SEND_DENY = SEND.toString()

// ── Panel ────────────────────────────────────────────────────────────────────

/** How members pick a ticket type from the panel. */
export type PanelMode = 'buttons' | 'dropdown'

export type TicketPanel = {
  channel_id?: string | null
  /** Discord message id of the live panel (set after it's posted). */
  message_id?: string | null
  title: string
  description: string
  color: string
  mode: PanelMode
  /** Label for the single button in `buttons` mode with one type / the lead CTA. */
  button_label: string
}

export function defaultPanel(): TicketPanel {
  return {
    channel_id: null,
    message_id: null,
    title: '🎫 Need help? Open a ticket',
    description:
      'Pick the option that best matches your request below. A private channel will be created where our team can help you.',
    color: '#5865f2',
    mode: 'buttons',
    button_label: 'Open a ticket',
  }
}

// ── Auto-close ───────────────────────────────────────────────────────────────

export type AutoCloseConfig = {
  enabled: boolean
  /** Hours of inactivity before a ticket is auto-closed. */
  inactivity_hours: number
  /** Hours of inactivity before a warning is posted (0 = no warning). */
  warn_hours: number
}

export function defaultAutoClose(): AutoCloseConfig {
  return { enabled: false, inactivity_hours: 48, warn_hours: 24 }
}

// ── Config ───────────────────────────────────────────────────────────────────

export type TicketConfig = {
  guild_id: string
  enabled: boolean
  panel: TicketPanel
  ticket_types: TicketType[]
  category_id: string | null
  support_role_ids: string[]
  transcript_channel_id: string | null
  log_channel_id: string | null
  naming_format: string
  opening_message: string | null
  auto_close: AutoCloseConfig
  per_user_limit: number
  ping_support: boolean
  ticket_counter: number
  updated_at?: string
}

export const TICKET_LIMITS = {
  maxTypes: 12,
  maxFormFields: 5,
  maxSupportRoles: 25,
  /** Discord caps a select menu at 25 options and an action row at 5 buttons. */
  maxPanelButtons: 5,
  maxNameLength: 90,
} as const

export function defaultTicketConfig(guildId: string): TicketConfig {
  return {
    guild_id: guildId,
    enabled: false,
    panel: defaultPanel(),
    ticket_types: DEFAULT_TICKET_TYPES.map((t) => ({ ...t })),
    category_id: null,
    support_role_ids: [],
    transcript_channel_id: null,
    log_channel_id: null,
    naming_format: 'ticket-{number}',
    opening_message:
      'Hey {user} — thanks for reaching out! Describe your issue and a member of the team will be with you shortly.',
    auto_close: defaultAutoClose(),
    per_user_limit: 1,
    ping_support: true,
    ticket_counter: 0,
  }
}

/** Coerce a raw DB row (loose JSON) into a fully-shaped, safe TicketConfig. */
export function normaliseConfig(guildId: string, row: Record<string, unknown> | null | undefined): TicketConfig {
  const base = defaultTicketConfig(guildId)
  if (!row) return base

  const panelRaw = (row.panel ?? {}) as Partial<TicketPanel>
  const autoRaw = (row.auto_close ?? {}) as Partial<AutoCloseConfig>

  return {
    guild_id: guildId,
    enabled: Boolean(row.enabled),
    panel: {
      channel_id: (panelRaw.channel_id as string) ?? null,
      message_id: (panelRaw.message_id as string) ?? null,
      title: typeof panelRaw.title === 'string' ? panelRaw.title : base.panel.title,
      description: typeof panelRaw.description === 'string' ? panelRaw.description : base.panel.description,
      color: isHexColor(panelRaw.color) ? (panelRaw.color as string) : base.panel.color,
      mode: panelRaw.mode === 'dropdown' ? 'dropdown' : 'buttons',
      button_label: typeof panelRaw.button_label === 'string' ? panelRaw.button_label : base.panel.button_label,
    },
    ticket_types: Array.isArray(row.ticket_types) && row.ticket_types.length > 0
      ? (row.ticket_types as unknown[]).map(normaliseType).filter(Boolean) as TicketType[]
      : base.ticket_types,
    category_id: (row.category_id as string) ?? null,
    support_role_ids: toStringArray(row.support_role_ids),
    transcript_channel_id: (row.transcript_channel_id as string) ?? null,
    log_channel_id: (row.log_channel_id as string) ?? null,
    naming_format: typeof row.naming_format === 'string' && row.naming_format.trim()
      ? row.naming_format : base.naming_format,
    opening_message: typeof row.opening_message === 'string' ? row.opening_message : base.opening_message,
    auto_close: {
      enabled: Boolean(autoRaw.enabled),
      inactivity_hours: clampNum(autoRaw.inactivity_hours, 1, 720, 48),
      warn_hours: clampNum(autoRaw.warn_hours, 0, 720, 24),
    },
    per_user_limit: clampNum(row.per_user_limit, 0, 50, 1),
    ping_support: row.ping_support === undefined ? true : Boolean(row.ping_support),
    ticket_counter: clampNum(row.ticket_counter, 0, Number.MAX_SAFE_INTEGER, 0),
    updated_at: (row.updated_at as string) ?? undefined,
  }
}

function normaliseType(raw: unknown): TicketType | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  const id = typeof t.id === 'string' && t.id.trim() ? slugify(t.id) : ''
  const label = typeof t.label === 'string' ? t.label.trim() : ''
  if (!id || !label) return null
  const form = Array.isArray(t.form)
    ? (t.form as unknown[]).map(normaliseField).filter(Boolean).slice(0, TICKET_LIMITS.maxFormFields) as TicketFormField[]
    : []
  return {
    id,
    label: label.slice(0, 60),
    emoji: typeof t.emoji === 'string' ? t.emoji.slice(0, 8) : undefined,
    description: typeof t.description === 'string' ? t.description.slice(0, 100) : undefined,
    color: isHexColor(t.color) ? (t.color as string) : undefined,
    enabled: t.enabled === undefined ? true : Boolean(t.enabled),
    category_id: (t.category_id as string) ?? null,
    support_role_ids: toStringArray(t.support_role_ids),
    form,
  }
}

function normaliseField(raw: unknown): TicketFormField | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Record<string, unknown>
  const label = typeof f.label === 'string' ? f.label.trim() : ''
  if (!label) return null
  return {
    id: typeof f.id === 'string' && f.id.trim() ? slugify(f.id) : slugify(label),
    label: label.slice(0, 45),
    style: f.style === 'paragraph' ? 'paragraph' : 'short',
    required: f.required === undefined ? true : Boolean(f.required),
    placeholder: typeof f.placeholder === 'string' ? f.placeholder.slice(0, 100) : undefined,
    max_length: clampNum(f.max_length, 1, 4000, f.style === 'paragraph' ? 1000 : 100),
  }
}

/** Returns an error string if the config can't be saved, else null. */
export function validateConfig(c: TicketConfig): string | null {
  const enabledTypes = c.ticket_types.filter((t) => t.enabled)
  if (c.enabled && enabledTypes.length === 0) {
    return 'Enable at least one ticket type before turning the system on.'
  }
  if (c.ticket_types.length > TICKET_LIMITS.maxTypes) {
    return `You can have at most ${TICKET_LIMITS.maxTypes} ticket types.`
  }
  if (c.panel.mode === 'buttons' && enabledTypes.length > TICKET_LIMITS.maxPanelButtons) {
    return `Button panels support up to ${TICKET_LIMITS.maxPanelButtons} types — switch to a dropdown panel or disable some types.`
  }
  const ids = new Set<string>()
  for (const t of c.ticket_types) {
    if (ids.has(t.id)) return `Duplicate ticket type id "${t.id}".`
    ids.add(t.id)
  }
  if (!c.naming_format.includes('{number}') && !c.naming_format.includes('{user}')) {
    return 'The channel name format must include {number} or {user} so names stay unique.'
  }
  return null
}

// ── Channel naming ─────────────────────────────────────────────────────────────

/**
 * Render the channel-name template for a new ticket. Discord text-channel names
 * are lowercased, dash-joined and stripped of punctuation — we normalise here so
 * the bot and the dashboard preview agree on the result.
 */
export function formatChannelName(
  format: string,
  ctx: { number: number; user: string; type?: string },
): string {
  const raw = (format || 'ticket-{number}')
    .replace(/\{number\}/g, String(ctx.number))
    .replace(/\{user\}/g, ctx.user || 'user')
    .replace(/\{type\}/g, ctx.type || 'ticket')
  return raw
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, TICKET_LIMITS.maxNameLength) || `ticket-${ctx.number}`
}

// ── Analytics (pure, derived from the loaded ticket rows) ────────────────────

export type TicketRow = {
  id: string
  number: number
  status: string
  priority: string
  type_id: string | null
  type_label: string | null
  opener_id: string
  claimed_by: string | null
  opened_at: string
  closed_at: string | null
}

/** Full ticket record as stored — passed from the server page to the client UI. */
export type Ticket = {
  id: string
  guild_id: string
  number: number
  channel_id: string | null
  type_id: string | null
  type_label: string | null
  subject: string | null
  status: TicketStatus
  priority: TicketPriority
  opener_id: string
  opener_name: string | null
  claimed_by: string | null
  claimed_by_name: string | null
  participants: string[]
  form_answers: { label: string; value: string }[]
  opened_at: string
  last_activity_at: string
  closed_at: string | null
  closed_by: string | null
  closed_by_name: string | null
  close_reason: string | null
  /** Present (non-empty) once a transcript has been captured at close. */
  has_transcript: boolean
}

export type TicketEvent = {
  id: number
  ticket_id: string
  type: TicketEventType
  actor_id: string | null
  actor_name: string | null
  detail: string | null
  created_at: string
}

export type TicketStats = {
  total: number
  open: number
  closed: number
  claimed: number
  unclaimed: number
  byType: { id: string; label: string; count: number }[]
  byPriority: { priority: TicketPriority; count: number }[]
  /** Mean resolution time over closed tickets, in ms (null if none closed). */
  avgResolutionMs: number | null
  /** Daily opened/closed counts over the last `days` days (oldest → newest). */
  series: { date: string; opened: number; closed: number }[]
  /** Closed-with-a-resolution rate, 0–100. */
  resolutionRate: number
}

export function computeTicketStats(tickets: TicketRow[], days = 14): TicketStats {
  let open = 0
  let closed = 0
  let claimed = 0
  let resolutionTotal = 0
  let resolutionCount = 0
  const typeCounts = new Map<string, { label: string; count: number }>()
  const priorityCounts = new Map<TicketPriority, number>()

  for (const t of tickets) {
    const status = normaliseStatus(t.status)
    if (status === 'closed') closed++
    else open++
    if (t.claimed_by) claimed++

    const typeId = t.type_id ?? 'unknown'
    const entry = typeCounts.get(typeId) ?? { label: t.type_label ?? 'Other', count: 0 }
    entry.count++
    typeCounts.set(typeId, entry)

    const p = normalisePriority(t.priority)
    priorityCounts.set(p, (priorityCounts.get(p) ?? 0) + 1)

    if (status === 'closed' && t.closed_at) {
      const ms = new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime()
      if (ms > 0) {
        resolutionTotal += ms
        resolutionCount++
      }
    }
  }

  // Daily series for the trends chart.
  const series: { date: string; opened: number; closed: number }[] = []
  const dayMs = 86_400_000
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const buckets = new Map<string, { opened: number; closed: number }>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(startOfToday.getTime() - i * dayMs)
    const key = d.toISOString().slice(0, 10)
    buckets.set(key, { opened: 0, closed: 0 })
  }
  for (const t of tickets) {
    const openKey = t.opened_at.slice(0, 10)
    if (buckets.has(openKey)) buckets.get(openKey)!.opened++
    if (t.closed_at) {
      const closeKey = t.closed_at.slice(0, 10)
      if (buckets.has(closeKey)) buckets.get(closeKey)!.closed++
    }
  }
  for (const [date, v] of buckets) series.push({ date, ...v })

  const byType = [...typeCounts.entries()]
    .map(([id, v]) => ({ id, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count)
  const byPriority = PRIORITIES.map((priority) => ({ priority, count: priorityCounts.get(priority) ?? 0 }))

  return {
    total: tickets.length,
    open,
    closed,
    claimed,
    unclaimed: open - claimed > 0 ? open - claimed : 0,
    byType,
    byPriority,
    avgResolutionMs: resolutionCount > 0 ? Math.round(resolutionTotal / resolutionCount) : null,
    series,
    resolutionRate: tickets.length > 0 ? Math.round((closed / tickets.length) * 100) : 0,
  }
}

/** Compact human duration: "3h 12m", "2d 4h", "45m". */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000))
  if (totalMin < 60) return `${totalMin}m`
  const totalHr = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (totalHr < 24) return min > 0 ? `${totalHr}h ${min}m` : `${totalHr}h`
  const days = Math.floor(totalHr / 24)
  const hr = totalHr % 24
  return hr > 0 ? `${days}d ${hr}h` : `${days}d`
}

/** Relative timestamp: "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60000) return 'just now'
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

// ── Small shared utilities ───────────────────────────────────────────────────

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'type'
}

export function isHexColor(v: unknown): boolean {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
}

export function hexToInt(hex: string): number {
  const v = parseInt(hex.replace('#', ''), 16)
  return Number.isNaN(v) ? 0x5865f2 : v
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
