import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getFeedbackViewer, mapFeedback } from '@/lib/feedback-server'
import { validateFeedback, type FeedbackRow, type FeedbackStatus } from '@/lib/feedback'

const VALID_STATUS: FeedbackStatus[] = ['visible', 'hidden', 'removed']

/** Max operator-curated entries shown on the landing page. */
const MAX_FEATURED = 3

/**
 * PATCH /api/feedback/[id]
 *
 * Two distinct edit paths through one handler:
 *   • Author edit  → body { title, message, rating }. Requires ownership.
 *   • Moderation   → body { status }. Requires operator. Lets operators hide or
 *                    remove abusive feedback (visibility controls).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const viewer = await getFeedbackViewer()
  if (!viewer.userId) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('feedback')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Feedback not found.' }, { status: 404 })

  const row = existing as FeedbackRow

  // Moderation path: status change is operator-only.
  if (typeof body.status === 'string') {
    if (!viewer.isOperator) {
      return NextResponse.json({ error: 'Only Pulsify operators can moderate feedback.' }, { status: 403 })
    }
    const status = body.status as FeedbackStatus
    if (!VALID_STATUS.includes(status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('feedback')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: 'Could not update feedback.' }, { status: 500 })
    return NextResponse.json({ feedback: mapFeedback(data as FeedbackRow, viewer, new Set()) })
  }

  // Landing-showcase path: feature / unfeature is operator-only and capped at 3.
  if (typeof body.featured === 'boolean') {
    if (!viewer.isOperator) {
      return NextResponse.json({ error: 'Only Pulsify operators can feature feedback.' }, { status: 403 })
    }
    const next = body.featured
    if (next && !row.featured) {
      const { count } = await supabase
        .from('feedback')
        .select('id', { count: 'exact', head: true })
        .eq('featured', true)
      if ((count ?? 0) >= MAX_FEATURED) {
        return NextResponse.json(
          { error: `You can feature at most ${MAX_FEATURED} reviews on the landing page. Unfeature one first.` },
          { status: 400 },
        )
      }
    }
    const { data, error } = await supabase
      .from('feedback')
      .update({
        featured: next,
        featured_at: next ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: 'Could not update feedback.' }, { status: 500 })
    return NextResponse.json({ feedback: mapFeedback(data as FeedbackRow, viewer, new Set()) })
  }

  // Author edit path: must own the entry.
  if (row.user_id !== viewer.userId) {
    return NextResponse.json({ error: 'You can only edit your own feedback.' }, { status: 403 })
  }
  const valid = validateFeedback(body)
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 })

  const { data, error } = await supabase
    .from('feedback')
    .update({
      title: valid.value.title,
      message: valid.value.message,
      rating: valid.value.rating,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: 'Could not update your feedback.' }, { status: 500 })
  return NextResponse.json({ feedback: mapFeedback(data as FeedbackRow, viewer, new Set()) })
}

/**
 * DELETE /api/feedback/[id] — remove feedback. Allowed for the author (deleting
 * their own) or an operator (moderation removal). Cascades drop the votes/reports.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const viewer = await getFeedbackViewer()
  if (!viewer.userId) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('feedback')
    .select('user_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Feedback not found.' }, { status: 404 })

  if ((existing as { user_id: string }).user_id !== viewer.userId && !viewer.isOperator) {
    return NextResponse.json({ error: 'You can only delete your own feedback.' }, { status: 403 })
  }

  const { error } = await supabase.from('feedback').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not delete feedback.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
