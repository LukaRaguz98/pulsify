import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getFeedbackViewer } from '@/lib/feedback-server'

/**
 * POST /api/feedback/[id]/vote — toggle the signed-in user's "helpful" upvote.
 *
 * Anti-manipulation: votes are keyed by (feedback_id, user_id) so a user can
 * vote at most once (a second POST removes the vote — a toggle). Self-voting is
 * refused (the author can't inflate their own entry). The parent's vote_count
 * is kept exact by a DB trigger, so we read it back after the change.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const viewer = await getFeedbackViewer()
  if (!viewer.userId) {
    return NextResponse.json({ error: 'You must be signed in to vote.' }, { status: 401 })
  }

  const supabase = await createClient()
  const { data: target } = await supabase
    .from('feedback')
    .select('user_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Feedback not found.' }, { status: 404 })

  const t = target as { user_id: string; status: string }
  if (t.status !== 'visible') {
    return NextResponse.json({ error: 'This feedback is not available.' }, { status: 409 })
  }
  if (t.user_id === viewer.userId) {
    return NextResponse.json({ error: 'You cannot vote on your own feedback.' }, { status: 403 })
  }

  // Toggle: delete an existing vote, otherwise insert one.
  const { data: existing } = await supabase
    .from('feedback_votes')
    .select('feedback_id')
    .eq('feedback_id', id)
    .eq('user_id', viewer.userId)
    .maybeSingle()

  let hasVoted: boolean
  if (existing) {
    await supabase.from('feedback_votes').delete().eq('feedback_id', id).eq('user_id', viewer.userId)
    hasVoted = false
  } else {
    const { error } = await supabase
      .from('feedback_votes')
      .insert({ feedback_id: id, user_id: viewer.userId })
    // 23505 = the user already voted (raced) — treat as voted, not an error.
    if (error && error.code !== '23505') {
      return NextResponse.json({ error: 'Could not record your vote.' }, { status: 500 })
    }
    hasVoted = true
  }

  // Read back the trigger-maintained count for an authoritative UI update.
  const { data: fresh } = await supabase
    .from('feedback')
    .select('vote_count')
    .eq('id', id)
    .maybeSingle()

  return NextResponse.json({
    hasVoted,
    voteCount: (fresh as { vote_count: number } | null)?.vote_count ?? 0,
  })
}
