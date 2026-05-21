import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export type CommandLogStatus =
  | 'success'
  | 'failed'
  | 'denied'
  | 'cooldown'
  | 'rate_limited'
  | 'maintenance'
  | 'disabled'

export type CommandLogRow = {
  id: number
  guild_id: string
  command_name: string
  user_id: string | null
  user_name: string | null
  channel_id: string | null
  channel_name: string | null
  status: CommandLogStatus
  detail: string | null
  duration_ms: number | null
  created_at: string
}

const ALLOWED_STATUS = new Set<CommandLogStatus>([
  'success',
  'failed',
  'denied',
  'cooldown',
  'rate_limited',
  'maintenance',
  'disabled',
])

export async function GET(
  req: Request,
  ctx: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const limitParam = Number(url.searchParams.get('limit') ?? '200')
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(500, Math.floor(limitParam)))
    : 200

  const statusParam = (url.searchParams.get('status') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is CommandLogStatus => ALLOWED_STATUS.has(s as CommandLogStatus))
  const command = url.searchParams.get('command')?.trim()

  let query = supabase
    .from('command_logs')
    .select(
      'id, guild_id, command_name, user_id, user_name, channel_id, channel_name, status, detail, duration_ms, created_at',
    )
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (statusParam.length > 0) query = query.in('status', statusParam)
  if (command) query = query.eq('command_name', command)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json((data ?? []) as CommandLogRow[])
}
