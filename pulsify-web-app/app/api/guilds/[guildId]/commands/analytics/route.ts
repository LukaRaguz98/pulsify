import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import {
  timeframeSince,
  timeframeBucket,
  type Timeframe,
} from '@/lib/analytics'

export type CommandStatRow = {
  command_name: string
  total: number
  success: number
  failed: number
  denied: number
  last_used: string | null
}

export type CommandTrendPoint = {
  bucket: string
  total: number
  success: number
  failed: number
}

export type CommandAnalytics = {
  timeframe: Timeframe
  stats: CommandStatRow[]
  trends: CommandTrendPoint[]
}

const VALID_TIMEFRAMES: Timeframe[] = ['24h', '7d', '30d', 'all']

export async function GET(
  req: Request,
  ctx: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await ctx.params
  // Management data — requires Manage Server / Administrator on this guild.
  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const tfParam = url.searchParams.get('timeframe') as Timeframe | null
  const timeframe: Timeframe = tfParam && VALID_TIMEFRAMES.includes(tfParam) ? tfParam : '7d'
  const since = timeframeSince(timeframe)
  const trunc = timeframeBucket(timeframe)

  const [statsRes, trendsRes] = await Promise.all([
    supabase.rpc('get_command_stats', { p_guild_id: guildId, p_since: since }),
    supabase.rpc('get_command_trends', {
      p_guild_id: guildId,
      p_since: since,
      p_trunc: trunc,
    }),
  ])

  if (statsRes.error) {
    return NextResponse.json({ error: statsRes.error.message }, { status: 500 })
  }
  if (trendsRes.error) {
    return NextResponse.json({ error: trendsRes.error.message }, { status: 500 })
  }

  const payload: CommandAnalytics = {
    timeframe,
    stats: (statsRes.data ?? []) as CommandStatRow[],
    trends: (trendsRes.data ?? []) as CommandTrendPoint[],
  }
  return NextResponse.json(payload)
}
