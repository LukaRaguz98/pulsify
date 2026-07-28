import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { requireGuildFeature } from '@/lib/billing-server'
import {
  applySettingsRetention,
  fetchGames,
  fetchHeatmap,
  fetchOverview,
  fetchPlayers,
  gamingWindow,
  getGamingSettings,
} from '@/lib/gaming-query'
import { anonymisePlayerStats, peakActivity, type HeatmapCell } from '@/lib/gaming'
import { isTimeframe, timeframePeriodLabel, type Timeframe } from '@/lib/analytics'

/**
 * GET /api/guilds/[guildId]/gaming/community
 *
 * The member-facing half of Gaming Analytics: what this server plays, who plays
 * it, and when — for the people who might want to join in, rather than for
 * whoever administrates them.
 *
 * A SEPARATE ROUTE RATHER THAN A ROLE BRANCH IN THE ADMIN ONE. The admin
 * payload is a management surface: per-member session counts, retention
 * bookkeeping, plan upgrade prompts, the heatmap grid. Trimming that down per
 * caller would mean every future field added there is exposed to members by
 * default until someone remembers to exclude it. Here the default is the other
 * way round — nothing reaches a member unless this file puts it in the
 * response.
 *
 * What is deliberately NOT here: session-level history, exports, per-member
 * drill-downs, squad detection, the module's settings, and the retention /
 * upgrade messaging (a member can neither change a setting nor buy a plan, so
 * telling them the window is capped is noise they cannot act on).
 */

const DEFAULT_TIMEFRAME: Timeframe = '30d'

/** Enough to browse; not enough to be a directory of everyone who has ever played. */
const MAX_GAMES = 24
const MAX_PLAYERS = 25

function validTimeZone(tz: string | null): string {
  if (!tz) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

const fail = (message: string) =>
  NextResponse.json({ error: `Gaming query failed: ${message}` }, { status: 500 })

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params

  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const tfParam = url.searchParams.get('timeframe')
  const timeframe: Timeframe = isTimeframe(tfParam) ? tfParam : DEFAULT_TIMEFRAME
  const tz = validTimeZone(url.searchParams.get('tz'))

  const supabase = await createClient()
  const settings = await getGamingSettings(supabase, guildId)

  // Tracking off means there is nothing to show and nothing to explain — the
  // member view says so plainly and offers no "turn it on", which isn't theirs.
  if (!settings.enabled) {
    return NextResponse.json({ enabled: false, anonymise: settings.anonymizeStats })
  }

  const window = applySettingsRetention(await gamingWindow(guildId, timeframe), settings)
  const advanced = await requireGuildFeature(guildId, 'advancedGamingAnalytics')

  const [overviewRes, gamesRes, playersRes, heatmapRes] = await Promise.all([
    fetchOverview(supabase, guildId, window.since, tz),
    fetchGames(supabase, guildId, window.since, tz),
    fetchPlayers(supabase, guildId, window.since),
    // Only read to answer "when does this server play". Free servers don't get
    // that section at all, so on Free the query isn't run either.
    advanced.ok
      ? fetchHeatmap(supabase, guildId, window.since, tz)
      : Promise.resolve({ cells: [] as HeatmapCell[] }),
  ])

  if ('error' in overviewRes) return fail(overviewRes.error)
  if ('error' in gamesRes) return fail(gamesRes.error)
  if ('error' in playersRes) return fail(playersRes.error)
  if ('error' in heatmapRes) return fail(heatmapRes.error)

  const games = [...gamesRes.games]
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, MAX_GAMES)

  const ranked = [...playersRes.players]
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, MAX_PLAYERS)
  const players = settings.anonymizeStats ? anonymisePlayerStats(ranked) : ranked

  return NextResponse.json({
    enabled: true,
    anonymise: settings.anonymizeStats,
    window: {
      timeframe: window.timeframe,
      days: window.days,
      periodLabel: timeframePeriodLabel(window.timeframe),
      timezone: tz,
    },
    overview: overviewRes.overview,
    games,
    players,
    // Null rather than a zeroed object: "we don't show this" and "nobody has
    // played yet" are different answers, and the UI omits the section for the
    // first rather than printing an empty one.
    peaks: advanced.ok ? peakActivity(heatmapRes.cells) : null,
  })
}
