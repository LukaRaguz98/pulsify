import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import {
  getFeedbackViewer,
  listFeedback,
  getOwnFeedback,
  mapFeedback,
} from '@/lib/feedback-server'
import { validateFeedback, type FeedbackRow, type FeedbackSort, type RatingFilter } from '@/lib/feedback'

/**
 * GET /api/feedback?sort=&q=&rating=
 *
 * Public feedback wall (only `visible` entries). Returns the list plus a small
 * viewer summary (so the client can show vote/own/operator affordances) and the
 * viewer's own feedback (any status), which drives the submit-vs-edit form.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sortParam = searchParams.get('sort')
  const sort: FeedbackSort =
    sortParam === 'new' || sortParam === 'helpful' ? sortParam : 'top'
  const q = searchParams.get('q') ?? undefined
  const ratingRaw = Number(searchParams.get('rating') ?? 0)
  const rating = (Number.isInteger(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5
    ? ratingRaw
    : 0) as RatingFilter

  const { items, viewer } = await listFeedback({ sort, q, rating })
  const own = await getOwnFeedback(viewer)

  return NextResponse.json({
    items,
    own,
    viewer: { userId: viewer.userId, isOperator: viewer.isOperator },
  })
}

/**
 * POST /api/feedback — create the signed-in user's feedback.
 *
 * Anonymous submissions are refused (no actor ⇒ 401). One feedback per author
 * is enforced by the unique(user_id) constraint; a second submit returns 409 so
 * the client can switch to "edit your existing feedback". The author's Discord
 * identity is snapshotted onto the row for graceful rendering later.
 */
export async function POST(req: Request) {
  const viewer = await getFeedbackViewer()
  if (!viewer.userId || !viewer.actor) {
    return NextResponse.json({ error: 'You must be signed in to leave feedback.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const valid = validateFeedback(body as Record<string, unknown>)
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('feedback')
    .insert({
      user_id: viewer.userId,
      author_name: viewer.actor.username,
      author_handle: viewer.actor.handle,
      author_avatar: viewer.actor.avatarUrl,
      title: valid.value.title,
      message: valid.value.message,
      rating: valid.value.rating,
    })
    .select('*')
    .single()

  if (error) {
    // 23505 = unique_violation on user_id ⇒ they already left feedback.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'You have already left feedback — edit your existing entry instead.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'Could not save your feedback.' }, { status: 500 })
  }

  return NextResponse.json(
    { feedback: mapFeedback(data as FeedbackRow, viewer, new Set()) },
    { status: 201 },
  )
}
