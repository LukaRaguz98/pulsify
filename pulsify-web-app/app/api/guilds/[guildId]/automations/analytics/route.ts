import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import {
  timeframeSince,
  timeframeBucket,
  type Timeframe,
} from '@/lib/analytics'

export type AutomationStatRow = {
  automation_id: string | null
  automation_name: string | null
  action_type: string | null
  total: number
  success: number
  failed: number
  skipped: number
  last_run: string | null
}

export type AutomationTrendPoint = {
  bucket: string
  total: number
  success: number
  failed: number
}

export type AutomationAnalytics = {
  timeframe: Timeframe
  stats: AutomationStatRow[]
  trends: AutomationTrendPoint[]
}

const VALID_TIMEFRAMES: Timeframe[] = ['24h', '7d', '30d', 'all']

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
  const tfParam = url.searchParams.get('timeframe') as Timeframe | null
  const timeframe: Timeframe = tfParam && VALID_TIMEFRAMES.includes(tfParam) ? tfParam : '7d'
  const since = timeframeSince(timeframe)
  const trunc = timeframeBucket(timeframe)

  const [statsRes, trendsRes] = await Promise.all([
    supabase.rpc('get_automation_stats', { p_guild_id: guildId, p_since: since }),
    supabase.rpc('get_automation_trends', {
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

  const payload: AutomationAnalytics = {
    timeframe,
    stats: (statsRes.data ?? []) as AutomationStatRow[],
    trends: (trendsRes.data ?? []) as AutomationTrendPoint[],
  }
  return NextResponse.json(payload)
}
