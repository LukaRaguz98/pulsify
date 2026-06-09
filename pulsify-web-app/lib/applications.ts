// Applications System catalog + pure helpers (PULSIFY-43).
//
// Applications are a CHANNEL-LESS upgrade of the old "Application" ticket type:
// a member picks what they're applying for, writes details, and submits — the
// submission is stored in `ticket_applications` and reviewed inside Pulsify
// (Tickets → Applications) instead of opening a Discord channel.
//
// Like lib/tickets.ts, this module is framework-free (icons referenced by lucide
// NAME, resolved in the UI layer) so it's trivially testable and the bot can
// mirror the same shapes in plain JS (pulse-bot/src/applications.js). The
// dashboard and the bot both read/write the same tables + share the custom_id
// scheme, so the type catalog, statuses and validation rules MUST agree — keep
// them in sync the same way lib/tickets.ts ↔ pulse-bot/src/tickets.js are.

import { timeAgo, slugify } from './tickets'

// Re-export so application UI can import time/format helpers from one place.
export { timeAgo, slugify }

// ── Statuses ────────────────────────────────────────────────────────────────

export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'needs_info'

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'pending',
  'approved',
  'rejected',
  'needs_info',
]

export const APPLICATION_STATUS_META: Record<
  ApplicationStatus,
  { label: string; icon: string; color: string; order: number }
> = {
  pending:    { label: 'Pending review',  icon: 'Clock',        color: '#f59e0b', order: 0 },
  approved:   { label: 'Approved',        icon: 'CheckCircle2', color: '#22c55e', order: 1 },
  rejected:   { label: 'Rejected',        icon: 'XCircle',      color: '#ef4444', order: 2 },
  needs_info: { label: 'Needs more info', icon: 'HelpCircle',   color: '#3b82f6', order: 3 },
}

export function normaliseApplicationStatus(v: unknown): ApplicationStatus {
  return APPLICATION_STATUSES.includes(v as ApplicationStatus)
    ? (v as ApplicationStatus)
    : 'pending'
}

/** An application is "open" (still needs a decision) while pending or needs_info. */
export function isOpenStatus(status: string): boolean {
  return status === 'pending' || status === 'needs_info'
}

// ── Review timeline / audit event types ──────────────────────────────────────

export type ApplicationEventType =
  | 'submitted'
  | 'status_changed'
  | 'note'
  | 'assigned'
  | 'reviewer_cleared'
  | 'info_requested'

export const APPLICATION_EVENT_META: Record<
  ApplicationEventType,
  { label: string; icon: string; accent: string }
> = {
  submitted:        { label: 'Submitted',      icon: 'Send',         accent: '#a855f7' },
  status_changed:   { label: 'Status changed', icon: 'RefreshCw',    accent: '#3b82f6' },
  note:             { label: 'Note',           icon: 'StickyNote',   accent: '#a855f7' },
  assigned:         { label: 'Reviewer set',   icon: 'UserCheck',    accent: '#3b82f6' },
  reviewer_cleared: { label: 'Reviewer cleared', icon: 'UserMinus',  accent: '#f59e0b' },
  info_requested:   { label: 'Info requested', icon: 'HelpCircle',   accent: '#3b82f6' },
}

// ── Application types ─────────────────────────────────────────────────────────

export type ApplicationType = {
  id: string
  label: string
  /** Single emoji shown on the select option. */
  emoji?: string
  description?: string
  enabled: boolean
}

// The "Other" escape hatch is ALWAYS available (not part of the editable
// catalog): picking it lets the applicant type a custom role/position.
export const OTHER_TYPE_ID = 'other'
export const OTHER_TYPE: ApplicationType = {
  id: OTHER_TYPE_ID,
  label: 'Other',
  emoji: '✨',
  description: 'Something else — tell us what.',
  enabled: true,
}

// The starter catalog an admin sees: the positions named in the spec. Editable
// per-server in Ticket Settings (stored on ticket_configs.application_types).
export const DEFAULT_APPLICATION_TYPES: ApplicationType[] = [
  { id: 'staff',        label: 'Staff',        emoji: '🛡️', enabled: true,  description: 'Join the staff team.' },
  { id: 'moderator',    label: 'Moderator',    emoji: '🔨', enabled: true,  description: 'Help moderate the community.' },
  { id: 'partner',      label: 'Partner',      emoji: '🤝', enabled: true,  description: 'Partner your server or project.' },
  { id: 'creator',      label: 'Creator',      emoji: '🎨', enabled: true,  description: 'Apply as a content creator.' },
  { id: 'support-team', label: 'Support Team', emoji: '🎧', enabled: true,  description: 'Help members in support.' },
  { id: 'event-team',   label: 'Event Team',   emoji: '🎉', enabled: true,  description: 'Run and host community events.' },
]

export const APPLICATION_LIMITS = {
  maxTypes: 24, // Discord caps a select menu at 25 options; we keep 1 for "Other".
  maxMessageLength: 2000,
  maxCustomTypeLength: 80,
  maxNoteLength: 1000,
  maxDecisionNoteLength: 1000,
} as const

/** Coerce a raw catalog (loose JSON) into a fully-shaped, safe type array. */
export function normaliseApplicationTypes(raw: unknown): ApplicationType[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_APPLICATION_TYPES.map((t) => ({ ...t }))
  }
  const out: ApplicationType[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const t = normaliseApplicationType(item)
    if (!t || t.id === OTHER_TYPE_ID || seen.has(t.id)) continue
    seen.add(t.id)
    out.push(t)
    if (out.length >= APPLICATION_LIMITS.maxTypes) break
  }
  return out.length > 0 ? out : DEFAULT_APPLICATION_TYPES.map((t) => ({ ...t }))
}

function normaliseApplicationType(raw: unknown): ApplicationType | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  const label = typeof t.label === 'string' ? t.label.trim() : ''
  if (!label) return null
  const id = typeof t.id === 'string' && t.id.trim() ? slugify(t.id) : slugify(label)
  if (!id) return null
  return {
    id,
    label: label.slice(0, 60),
    emoji: typeof t.emoji === 'string' ? t.emoji.slice(0, 8) : undefined,
    description: typeof t.description === 'string' ? t.description.slice(0, 100) : undefined,
    enabled: t.enabled === undefined ? true : Boolean(t.enabled),
  }
}

/** Enabled catalog types + the built-in "Other" — the options shown in Discord. */
export function selectableTypes(types: ApplicationType[]): ApplicationType[] {
  return [...types.filter((t) => t.enabled), OTHER_TYPE]
}

/** Resolve a picked type id to its label (handles the built-in "Other"). */
export function typeLabel(types: ApplicationType[], id: string): string {
  if (id === OTHER_TYPE_ID) return OTHER_TYPE.label
  return types.find((t) => t.id === id)?.label ?? id
}

// ── Interaction custom_ids (shared with pulse-bot/src/applications.js) ────────
// The ticket panel button/dropdown for a `kind:'application'` ticket type opens
// the application dialog instead of a channel. Both sides must agree on these.

export const APL = 'apl'
/** Ephemeral string-select listing the application types (+ "Other"). */
export const APPLICATION_SELECT_ID = `${APL}:type`
/** Modal carrying the chosen application type id; submitted by the member. */
export const applicationModalId = (typeId: string) => `${APL}:form:${typeId}`
/** Modal field ids. */
export const APPLICATION_FIELD_MESSAGE = 'message'
export const APPLICATION_FIELD_CUSTOM_TYPE = 'custom_type'

// ── Stored record shape (server page → client UI) ─────────────────────────────

export type Application = {
  id: string
  guild_id: string
  number: number
  type_id: string | null
  type_label: string | null
  custom_type: string | null
  applicant_id: string
  applicant_name: string | null
  applicant_avatar: string | null
  message: string | null
  answers: { label: string; value: string }[]
  status: ApplicationStatus
  reviewer_id: string | null
  reviewer_name: string | null
  decided_at: string | null
  decided_by: string | null
  decided_by_name: string | null
  decision_note: string | null
  created_at: string
  updated_at: string
}

export type ApplicationEvent = {
  id: number
  application_id: string
  type: ApplicationEventType
  actor_id: string | null
  actor_name: string | null
  detail: string | null
  created_at: string
}

/** Coerce a raw DB row into a fully-shaped Application. */
export function normaliseApplication(row: Record<string, unknown>): Application {
  return {
    id: String(row.id),
    guild_id: String(row.guild_id),
    number: Number(row.number) || 0,
    type_id: (row.type_id as string) ?? null,
    type_label: (row.type_label as string) ?? null,
    custom_type: (row.custom_type as string) ?? null,
    applicant_id: String(row.applicant_id),
    applicant_name: (row.applicant_name as string) ?? null,
    applicant_avatar: (row.applicant_avatar as string) ?? null,
    message: (row.message as string) ?? null,
    answers: Array.isArray(row.answers) ? (row.answers as { label: string; value: string }[]) : [],
    status: normaliseApplicationStatus(row.status),
    reviewer_id: (row.reviewer_id as string) ?? null,
    reviewer_name: (row.reviewer_name as string) ?? null,
    decided_at: (row.decided_at as string) ?? null,
    decided_by: (row.decided_by as string) ?? null,
    decided_by_name: (row.decided_by_name as string) ?? null,
    decision_note: (row.decision_note as string) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at ?? row.created_at),
  }
}

/** Best display label for an application's "applying for" value. */
export function applicationTypeDisplay(app: Pick<Application, 'type_id' | 'type_label' | 'custom_type'>): string {
  if (app.type_id === OTHER_TYPE_ID && app.custom_type) return app.custom_type
  return app.type_label ?? app.custom_type ?? 'Application'
}

/** Build the Discord CDN avatar URL for an applicant (or null for the default). */
export function applicantAvatarUrl(applicantId: string, avatar: string | null): string | null {
  if (!avatar) return null
  // Already a full URL (defensive — older rows may have stored one).
  if (avatar.startsWith('http')) return avatar
  const ext = avatar.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/avatars/${applicantId}/${avatar}.${ext}?size=64`
}
