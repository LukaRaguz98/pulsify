import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getFeedbackViewer } from '@/lib/feedback-server'

/**
 * POST /api/feedback/[id]/report — flag a feedback entry for operator review.
 *
 * One report per (feedback, reporter); a repeat is a no-op (idempotent). You
 * can't report your own feedback. The parent's report_count is bumped by a DB
 * trigger and surfaced to operators in the moderation UI.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const viewer = await getFeedbackViewer()
  if (!viewer.userId) {
    return NextResponse.json({ error: 'You must be signed in to report feedback.' }, { status: 401 })
  }

  let reason: string | null = null
  try {
    const body = (await req.json()) as { reason?: unknown }
    if (typeof body.reason === 'string') reason = body.reason.trim().slice(0, 300) || null
  } catch {
    // Reason is optional — ignore a missing/invalid body.
  }

  const supabase = await createClient()
  const { data: target } = await supabase
    .from('feedback')
    .select('user_id')
    .eq('id', id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Feedback not found.' }, { status: 404 })

  if ((target as { user_id: string }).user_id === viewer.userId) {
    return NextResponse.json({ error: 'You cannot report your own feedback.' }, { status: 403 })
  }

  const { error } = await supabase
    .from('feedback_reports')
    .insert({ feedback_id: id, user_id: viewer.userId, reason })
  // 23505 = already reported by this user — treat as success (idempotent).
  if (error && error.code !== '23505') {
    return NextResponse.json({ error: 'Could not submit your report.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
