import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { retentionWindow } from '@/lib/timeline-query'
import { EMPTY_STATS, type TimelineStats } from '@/lib/timeline'

/**
 * GET /api/guilds/[guildId]/timeline/stats
 *
 * The statistics strip: events today / this week, the busiest periods, the most
 * active administrators and the most modified modules.
 *
 * Everything comes from one `get_timeline_stats` call — the alternative was six
 * aggregate queries for one header. Actor identity comes back with it, so the
 * "Administrator" filter dropdown is populated from the same round trip via
 * `get_timeline_actors`.
 *
 * Bounded by the guild plan's `logRetentionDays`, so the numbers always
 * describe exactly the history the feed below them can show.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params

  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { retentionDays, since } = await retentionWindow(guildId)
  const supabase = await createClient()

  const [statsRes, actorsRes] = await Promise.all([
    supabase.rpc('get_timeline_stats', { p_guild_id: guildId, p_since: since }),
    supabase.rpc('get_timeline_actors', { p_guild_id: guildId, p_since: since }),
  ])

  if (statsRes.error) {
    return NextResponse.json(
      { error: `History statistics failed: ${statsRes.error.message}` },
      { status: 500 },
    )
  }

  // A guild with no events yet gets a null/partial object back — normalise it
  // so the UI never has to null-check every field of the stats strip.
  const raw = (statsRes.data ?? {}) as Partial<TimelineStats>
  const stats: TimelineStats = { ...EMPTY_STATS, ...raw }

  // The actor dropdown degrades to the top actors already in `stats` if the
  // secondary RPC fails — a filter list is not worth failing the page over.
  const actors = actorsRes.error
    ? stats.actors
    : (actorsRes.data ?? []).map((row: {
        actor_id: string
        actor_name: string | null
        actor_username: string | null
        event_count: number
      }) => ({
        id: row.actor_id,
        name: row.actor_name,
        username: row.actor_username,
        count: Number(row.event_count),
      }))

  return NextResponse.json({
    stats,
    actors,
    retentionDays: Number.isFinite(retentionDays) ? retentionDays : null,
    windowStart: since,
  })
}
