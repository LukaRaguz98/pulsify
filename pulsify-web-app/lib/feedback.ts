// Community Feedback & Testimonials (PULSIFY-39) — shared types, validation and
// the pure ranking/formatting helpers. No `server-only` or JSX imports live
// here so it can be pulled into client components, server components and route
// handlers alike (same stance as lib/templates.ts / lib/command-palette.ts).
//
// A piece of feedback is one author's product testimonial: a title, a message
// and a 1–5 star rating, plus a "helpful" vote count. The DB shape lives in
// supabase/migrations/20260608_feedback.sql.

// ── Validation limits ────────────────────────────────────────────────────────
// Mirrored on the client (live counters / disabled submit) and re-checked in
// the route handler so the limits hold even if the client is bypassed.
export const FEEDBACK_LIMITS = {
  titleMin: 3,
  titleMax: 80,
  messageMin: 10,
  messageMax: 600,
  ratingMin: 1,
  ratingMax: 5,
} as const

// ── Types ────────────────────────────────────────────────────────────────────

export type FeedbackStatus = 'visible' | 'hidden' | 'removed'

/** A feedback entry as returned to the client. */
export type Feedback = {
  id: string
  authorName: string | null
  authorHandle: string | null
  authorAvatar: string | null
  title: string
  message: string
  rating: number
  status: FeedbackStatus
  voteCount: number
  /** Only populated for operators (moderation queue); 0 otherwise. */
  reportCount: number
  /** Operator-pinned to the landing page showcase. */
  featured: boolean
  createdAt: string
  updatedAt: string
  /** True when the signed-in viewer authored this entry. */
  isOwn: boolean
  /** True when the signed-in viewer has upvoted this entry. */
  hasVoted: boolean
}

/** The raw DB row shape (snake_case) — used by the server mappers. */
export type FeedbackRow = {
  id: string
  user_id: string
  author_name: string | null
  author_handle: string | null
  author_avatar: string | null
  title: string
  message: string
  rating: number
  status: FeedbackStatus
  vote_count: number
  report_count: number
  featured: boolean
  featured_at: string | null
  created_at: string
  updated_at: string
}

export type FeedbackSort = 'top' | 'new' | 'helpful'

export const FEEDBACK_SORTS: { value: FeedbackSort; label: string }[] = [
  { value: 'top', label: 'Highest rated' },
  { value: 'new', label: 'Newest' },
  { value: 'helpful', label: 'Most helpful' },
]

/** Rating filter for the discovery page: 0 = "all ratings", else exact stars. */
export type RatingFilter = 0 | 1 | 2 | 3 | 4 | 5

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Popularity score used for the "Highest rated" sort and the landing top-3.
 * Rating is the primary signal (a 5★ should outrank a 3★) but helpful votes
 * break ties and let a well-loved entry climb — each vote is worth a small
 * fraction of a star so a single ★ difference still dominates noise.
 */
export function popularityScore(f: Pick<Feedback, 'rating' | 'voteCount'>): number {
  return f.rating * 100 + Math.min(f.voteCount, 99)
}

/** Sort comparator matching a FeedbackSort. Pure — used as a fallback / on the client. */
export function compareFeedback(sort: FeedbackSort): (a: Feedback, b: Feedback) => number {
  if (sort === 'new') {
    return (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)
  }
  if (sort === 'helpful') {
    return (a, b) => b.voteCount - a.voteCount || +new Date(b.createdAt) - +new Date(a.createdAt)
  }
  // top
  return (a, b) =>
    popularityScore(b) - popularityScore(a) || +new Date(b.createdAt) - +new Date(a.createdAt)
}

export type FeedbackInput = { title: string; message: string; rating: number }

/** Validate + normalise a submission. Returns the trimmed values or an error. */
export function validateFeedback(
  input: Partial<FeedbackInput>,
): { ok: true; value: FeedbackInput } | { ok: false; error: string } {
  const title = (input.title ?? '').trim()
  const message = (input.message ?? '').trim()
  const rating = Number(input.rating)

  if (title.length < FEEDBACK_LIMITS.titleMin) {
    return { ok: false, error: `Title must be at least ${FEEDBACK_LIMITS.titleMin} characters.` }
  }
  if (title.length > FEEDBACK_LIMITS.titleMax) {
    return { ok: false, error: `Title must be ${FEEDBACK_LIMITS.titleMax} characters or fewer.` }
  }
  if (message.length < FEEDBACK_LIMITS.messageMin) {
    return { ok: false, error: `Feedback must be at least ${FEEDBACK_LIMITS.messageMin} characters.` }
  }
  if (message.length > FEEDBACK_LIMITS.messageMax) {
    return { ok: false, error: `Feedback must be ${FEEDBACK_LIMITS.messageMax} characters or fewer.` }
  }
  if (!Number.isInteger(rating) || rating < FEEDBACK_LIMITS.ratingMin || rating > FEEDBACK_LIMITS.ratingMax) {
    return { ok: false, error: 'Please choose a rating between 1 and 5 stars.' }
  }

  return { ok: true, value: { title, message, rating } }
}

/** Aggregate stats shown above the wall (average rating + totals). */
export type FeedbackStats = { total: number; average: number; voteTotal: number }

export function computeStats(items: Pick<Feedback, 'rating' | 'voteCount'>[]): FeedbackStats {
  const total = items.length
  if (total === 0) return { total: 0, average: 0, voteTotal: 0 }
  const sum = items.reduce((acc, f) => acc + f.rating, 0)
  const voteTotal = items.reduce((acc, f) => acc + f.voteCount, 0)
  return { total, average: Math.round((sum / total) * 10) / 10, voteTotal }
}

/** A display name that never leaks an empty string for deleted/anon authors. */
export function authorDisplayName(f: Pick<Feedback, 'authorName' | 'authorHandle'>): string {
  return f.authorName?.trim() || f.authorHandle?.trim() || 'Pulsify member'
}

/** Initial letter for the avatar fallback. */
export function authorInitial(f: Pick<Feedback, 'authorName' | 'authorHandle'>): string {
  return authorDisplayName(f).charAt(0).toUpperCase()
}

/** Compact, locale-stable "Jun 6, 2026" date for cards. */
export function formatFeedbackDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
