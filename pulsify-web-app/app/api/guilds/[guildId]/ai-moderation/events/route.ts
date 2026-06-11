import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'

export type AIModerationEventRow = {
  id: string
  guild_id: string
  message_id: string | null
  channel_id: string | null
  channel_name: string | null
  author_id: string | null
  author_name: string | null
  author_username: string | null
  content: string
  categories: { id: string; label: string; score: number }[]
  top_category: string | null
  confidence: number
  confidence_label: 'low' | 'medium' | 'high' | null
  severity: 'low' | 'medium' | 'high'
  reasoning: string | null
  signals: { source: 'heuristic' | 'ai'; category: string; label: string; weight: number }[]
  status: 'pending' | 'auto_actioned' | 'resolved' | 'dismissed'
  action_taken: 'none' | 'flag' | 'delete' | 'warn' | 'timeout'
  action_meta: Record<string, unknown>
  moderator_verdict: 'correct' | 'incorrect' | null
  moderator_verdict_by: string | null
  moderator_verdict_at: string | null
  reviewer_id: string | null
  reviewer_name: string | null
  reviewed_at: string | null
  notes: string | null
  created_at: string
}

const ALLOWED_STATUS = new Set(['pending', 'auto_actioned', 'resolved', 'dismissed'])

export async function GET(
  req: Request,
  ctx: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await ctx.params
  // Management data — requires Manage Server / Administrator on this guild.
  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status') ?? ''
  const status = statusParam
    .split(',')
    .map((s) => s.trim())
    .filter((s) => ALLOWED_STATUS.has(s))
  const limitParam = Number(url.searchParams.get('limit') ?? '100')
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(500, Math.floor(limitParam))) : 100

  let query = supabase
    .from('ai_moderation_events')
    .select(
      'id, guild_id, message_id, channel_id, channel_name, author_id, author_name, author_username, content, categories, top_category, confidence, confidence_label, severity, reasoning, signals, status, action_taken, action_meta, moderator_verdict, moderator_verdict_by, moderator_verdict_at, reviewer_id, reviewer_name, reviewed_at, notes, created_at',
    )
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (status.length > 0) query = query.in('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
