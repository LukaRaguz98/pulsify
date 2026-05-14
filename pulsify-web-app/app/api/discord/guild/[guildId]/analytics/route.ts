import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import {
  timeframeSince,
  timeframeBucket,
  EMPTY_SUMMARY,
  type Timeframe,
  type AnalyticsData,
} from '@/lib/analytics'

const VALID_TIMEFRAMES: Timeframe[] = ['24h', '7d', '30d', 'all']

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId } = await params

  const tfParam = new URL(req.url).searchParams.get('timeframe') as Timeframe | null
  const timeframe: Timeframe =
    tfParam && VALID_TIMEFRAMES.includes(tfParam) ? tfParam : '7d'

  const since = timeframeSince(timeframe)
  const trunc = timeframeBucket(timeframe)

  const [summary, timeseries, topChannels, topUsers, peakHours] = await Promise.all([
    supabase.rpc('get_analytics_summary', { p_guild_id: guildId, p_since: since }),
    supabase.rpc('get_analytics_timeseries', {
      p_guild_id: guildId,
      p_since: since,
      p_trunc: trunc,
    }),
    supabase.rpc('get_top_channels', { p_guild_id: guildId, p_since: since, p_limit: 8 }),
    supabase.rpc('get_top_users', { p_guild_id: guildId, p_since: since, p_limit: 8 }),
    supabase.rpc('get_peak_hours', { p_guild_id: guildId, p_since: since }),
  ])

  const error =
    summary.error ??
    timeseries.error ??
    topChannels.error ??
    topUsers.error ??
    peakHours.error
  if (error) {
    return NextResponse.json(
      { error: `Analytics query failed: ${error.message}` },
      { status: 500 }
    )
  }

  const data: AnalyticsData = {
    timeframe,
    summary: summary.data?.[0] ?? EMPTY_SUMMARY,
    timeseries: timeseries.data ?? [],
    topChannels: topChannels.data ?? [],
    topUsers: topUsers.data ?? [],
    peakHours: peakHours.data ?? [],
  }

  return NextResponse.json(data)
}
