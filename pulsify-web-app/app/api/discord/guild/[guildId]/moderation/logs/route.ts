import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId } = await params
  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 200)
  const action = url.searchParams.get('action')

  let query = supabase
    .from('moderation_logs')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (action) query = query.eq('action', action)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}
