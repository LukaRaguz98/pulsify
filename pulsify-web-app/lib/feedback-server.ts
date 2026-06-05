import 'server-only'
import { createClient } from '@/lib/supabase-server'
import { getCurrentDiscordUser, type WorkspaceActor } from '@/lib/workspace-auth'
import { isOperator } from '@/lib/operator'
import type { Feedback, FeedbackRow, FeedbackSort, RatingFilter } from '@/lib/feedback'

// Server-only data access + auth for the Community Feedback system (PULSIFY-39).
// Reuses the existing identity resolver (getCurrentDiscordUser) and operator
// gate (isOperator) so feedback shares the same auth boundary as the rest of
// the app — there is no feedback-specific notion of "logged in".

export type FeedbackViewer = {
  /** Discord user id, or null when signed out. */
  userId: string | null
  /** Identity snapshot, used to stamp author_* on create. */
  actor: WorkspaceActor | null
  /** Bot operator ⇒ may moderate any feedback. */
  isOperator: boolean
}

/** Resolve the current viewer once; cheap to pass down to mappers. */
export async function getFeedbackViewer(): Promise<FeedbackViewer> {
  const actor = await getCurrentDiscordUser()
  return {
    userId: actor?.userId ?? null,
    actor,
    isOperator: isOperator(actor?.userId),
  }
}

/** Map a raw row to the client shape, given the viewer + their voted set. */
export function mapFeedback(
  row: FeedbackRow,
  viewer: FeedbackViewer,
  votedIds: Set<string>,
): Feedback {
  return {
    id: row.id,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    authorAvatar: row.author_avatar,
    title: row.title,
    message: row.message,
    rating: row.rating,
    status: row.status,
    voteCount: row.vote_count,
    // Report counts are a moderation signal — only operators see them.
    reportCount: viewer.isOperator ? row.report_count : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isOwn: !!viewer.userId && row.user_id === viewer.userId,
    hasVoted: votedIds.has(row.id),
  }
}

/** Fetch the set of feedback ids the viewer has upvoted (empty when signed out). */
async function getVotedIds(userId: string | null): Promise<Set<string>> {
  if (!userId) return new Set()
  const supabase = await createClient()
  const { data } = await supabase
    .from('feedback_votes')
    .select('feedback_id')
    .eq('user_id', userId)
  return new Set((data ?? []).map((r) => r.feedback_id as string))
}

/**
 * Top visible feedback for the landing showcase. Ordered by rating, then
 * helpful votes, then recency — the same ranking the "Highest rated" sort uses
 * (popularityScore). Returns [] on any error so the landing falls back to the
 * static illustrative testimonials.
 */
export async function getTopFeedback(limit = 3): Promise<Feedback[]> {
  try {
    const viewer = await getFeedbackViewer()
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .eq('status', 'visible')
      .order('rating', { ascending: false })
      .order('vote_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error || !data) return []
    const votedIds = await getVotedIds(viewer.userId)
    return (data as FeedbackRow[]).map((r) => mapFeedback(r, viewer, votedIds))
  } catch {
    return []
  }
}

export type ListFeedbackOptions = {
  sort?: FeedbackSort
  /** Free-text search across title + message. */
  q?: string
  /** Exact star filter; 0 / undefined = all ratings. */
  rating?: RatingFilter
  limit?: number
}

/**
 * Public feedback wall used by the /feedback page and its API. Only `visible`
 * entries are returned (hidden/removed are moderation states). Search, rating
 * filter and sort all run in SQL so the client never holds the whole table.
 */
export async function listFeedback(
  opts: ListFeedbackOptions = {},
): Promise<{ items: Feedback[]; viewer: FeedbackViewer }> {
  const { sort = 'top', q, rating, limit = 60 } = opts
  const viewer = await getFeedbackViewer()
  const supabase = await createClient()

  let query = supabase.from('feedback').select('*').eq('status', 'visible')

  if (q && q.trim()) {
    const term = q.trim().replace(/[%,]/g, '')
    query = query.or(`title.ilike.%${term}%,message.ilike.%${term}%`)
  }
  if (rating && rating >= 1 && rating <= 5) {
    query = query.eq('rating', rating)
  }

  // Sorting. "top" mirrors popularityScore (rating ▸ votes ▸ recency); the
  // others are single-key with a recency tiebreaker.
  if (sort === 'new') {
    query = query.order('created_at', { ascending: false })
  } else if (sort === 'helpful') {
    query = query.order('vote_count', { ascending: false }).order('created_at', { ascending: false })
  } else {
    query = query
      .order('rating', { ascending: false })
      .order('vote_count', { ascending: false })
      .order('created_at', { ascending: false })
  }

  const { data, error } = await query.limit(limit)
  if (error || !data) return { items: [], viewer }

  const votedIds = await getVotedIds(viewer.userId)
  return {
    items: (data as FeedbackRow[]).map((r) => mapFeedback(r, viewer, votedIds)),
    viewer,
  }
}

/** The signed-in user's own feedback (any status), so they can edit/delete it. */
export async function getOwnFeedback(viewer: FeedbackViewer): Promise<Feedback | null> {
  if (!viewer.userId) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('feedback')
    .select('*')
    .eq('user_id', viewer.userId)
    .maybeSingle()
  if (!data) return null
  return mapFeedback(data as FeedbackRow, viewer, new Set())
}
