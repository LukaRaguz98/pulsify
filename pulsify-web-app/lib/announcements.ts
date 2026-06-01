// Announcements catalog + pure helpers (PULSIFY-33).
//
// No JSX / framework / IO imports live here (icons are referenced by lucide
// NAME, resolved in the UI layer) so this file is safe to import from both
// client components and server actions — same split as lib/giveaways.ts.
//
// Announcements are a DASHBOARD-ONLY surface: the dashboard authors drafts and
// publishes them to Discord via the REST API (the bot never touches the
// `announcements` table). The status model below is the single source of truth
// for both the server action and the UI.

// ── Statuses ──────────────────────────────────────────────────────────────────

export type AnnouncementStatus = 'draft' | 'published' | 'failed'

/**
 * The status surfaced in the UI. `scheduled` is a *derived* state — a draft that
 * carries a future `scheduled_for` — not a stored status, so the list can show
 * "Scheduled for …" without a dead status that never auto-fires.
 */
export type AnnouncementDisplayState = 'draft' | 'scheduled' | 'published' | 'failed'

export const STATUS_META: Record<
  AnnouncementDisplayState,
  { label: string; icon: string; color: string; order: number }
> = {
  published: { label: 'Published', icon: 'CheckCircle2',  color: '#22c55e', order: 0 },
  scheduled: { label: 'Scheduled', icon: 'CalendarClock', color: '#3b82f6', order: 1 },
  draft:     { label: 'Draft',     icon: 'FileText',      color: '#94a3b8', order: 2 },
  failed:    { label: 'Failed',    icon: 'AlertTriangle', color: '#ef4444', order: 3 },
}

export function normaliseStatus(v: unknown): AnnouncementStatus {
  return v === 'draft' || v === 'published' || v === 'failed' ? v : 'draft'
}

// ── Row model ───────────────────────────────────────────────────────────────

export type Announcement = {
  id: string
  guild_id: string
  title: string
  content: string
  channel_id: string
  message_id: string | null
  status: AnnouncementStatus
  scheduled_for: string | null
  published_at: string | null
  error: string | null
  author_id: string | null
  author_name: string | null
  created_at: string
  updated_at: string
}

export function normaliseAnnouncement(row: Record<string, unknown>): Announcement {
  return {
    id: String(row.id),
    guild_id: String(row.guild_id ?? ''),
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    channel_id: String(row.channel_id ?? ''),
    message_id: (row.message_id as string | null) ?? null,
    status: normaliseStatus(row.status),
    scheduled_for: (row.scheduled_for as string | null) ?? null,
    published_at: (row.published_at as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    author_id: (row.author_id as string | null) ?? null,
    author_name: (row.author_name as string | null) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  }
}

/**
 * Resolve the display state from the stored status + schedule: a draft with a
 * future `scheduled_for` reads as "Scheduled", everything else maps 1:1.
 */
export function displayState(a: Pick<Announcement, 'status' | 'scheduled_for'>): AnnouncementDisplayState {
  if (a.status === 'draft' && a.scheduled_for && new Date(a.scheduled_for).getTime() > Date.now()) {
    return 'scheduled'
  }
  return a.status
}

export function isEditable(a: Pick<Announcement, 'status'>): boolean {
  // Only un-published drafts (and failed attempts) can be edited — a published
  // announcement is a record of what was actually sent.
  return a.status === 'draft' || a.status === 'failed'
}

// ── Draft + validation ──────────────────────────────────────────────────────

export type AnnouncementDraft = {
  title: string
  content: string
  channel_id: string
  /** ISO string, or null for "no scheduled time". */
  scheduled_for: string | null
}

export const ANNOUNCEMENT_LIMITS = {
  maxTitle: 120,
  // Discord caps a single Components-V2 text display at 4000 chars; stay under
  // it with headroom for the title/footer the container adds around the body.
  maxContent: 3500,
} as const

/** Returns an error string for an invalid draft, or null when it's good to go. */
export function validateDraft(draft: AnnouncementDraft): string | null {
  if (!draft.title.trim()) return 'Give your announcement a title.'
  if (draft.title.trim().length > ANNOUNCEMENT_LIMITS.maxTitle) {
    return `Title must be ${ANNOUNCEMENT_LIMITS.maxTitle} characters or fewer.`
  }
  if (!draft.content.trim()) return 'Write the announcement message.'
  if (draft.content.trim().length > ANNOUNCEMENT_LIMITS.maxContent) {
    return `Message must be ${ANNOUNCEMENT_LIMITS.maxContent} characters or fewer.`
  }
  if (!/^\d{15,21}$/.test(draft.channel_id)) return 'Pick a channel to publish to.'
  if (draft.scheduled_for) {
    const t = new Date(draft.scheduled_for).getTime()
    if (Number.isNaN(t)) return 'The scheduled time is invalid.'
    if (t <= Date.now()) return 'The scheduled time must be in the future.'
  }
  return null
}

// ── Stats ───────────────────────────────────────────────────────────────────

export type AnnouncementStats = {
  total: number
  published: number
  drafts: number
  scheduled: number
  failed: number
}

export function computeAnnouncementStats(list: Announcement[]): AnnouncementStats {
  const stats: AnnouncementStats = { total: list.length, published: 0, drafts: 0, scheduled: 0, failed: 0 }
  for (const a of list) {
    switch (displayState(a)) {
      case 'published': stats.published++; break
      case 'scheduled': stats.scheduled++; break
      case 'failed':    stats.failed++; break
      default:          stats.drafts++; break
    }
  }
  return stats
}

/** Short single-line preview of the content for cards/lists. */
export function contentPreview(content: string, max = 140): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}
