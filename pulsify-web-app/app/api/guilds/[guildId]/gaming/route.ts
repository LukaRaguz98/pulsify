import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { requireGuildFeature } from '@/lib/billing-server'
import {
  applySettingsRetention,
  fetchDaily,
  fetchGameDaily,
  fetchGames,
  fetchHeatmap,
  fetchOverview,
  fetchPlayers,
  gamingWindow,
  getGamingSettings,
} from '@/lib/gaming-query'
import {
  computeCommunityInsights,
  computeGameTrends,
  newlyPlayedGames,
  peakActivity,
} from '@/lib/gaming'
import { isTimeframe, timeframePeriodLabel, type Timeframe } from '@/lib/analytics'

/**
 * GET /api/guilds/[guildId]/gaming
 *
 * Everything the Gaming dashboard needs for a given window, in one response:
 * the server overview, per-game and per-member aggregates, the daily series,
 * the hour × weekday heatmap, derived trends and community insights.
 *
 * ONE ROUTE RATHER THAN SIX. The page renders these together and re-fetches
 * them together whenever the window changes; splitting them would mean six
 * round trips that must agree with each other about "now" — and they wouldn't,
 * because each would compute its own `now` a few hundred milliseconds apart.
 * Live activity is the deliberate exception: it polls on its own cadence, so it
 * has its own route.
 *
 * Query params:
 *   `timeframe` — 24h | 7d | 30d | all, the SAME selector every other analytics
 *                 surface uses (lib/analytics.ts). Clamped by the plan's
 *                 `analyticsRetentionDays` and by the guild's own configured
 *                 retention, whichever is shorter.
 *   `tz`        — IANA timezone for day/hour bucketing. The browser sends its
 *                 own, so "busiest hour" means the hour the person reading the
 *                 chart experiences, not whatever UTC recorded.
 */

const DEFAULT_TIMEFRAME: Timeframe = '30d'

function validTimeZone(tz: string | null): string {
  if (!tz) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    // An invalid zone would make Postgres raise rather than fall back, so the
    // check happens here where a bad value is a query param, not an outage.
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

  // Gaming analytics exposes per-member activity, so it is a management
  // surface: Manage Server / Administrator only.
  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const tfParam = url.searchParams.get('timeframe')
  const timeframe: Timeframe = isTimeframe(tfParam) ? tfParam : DEFAULT_TIMEFRAME
  const tz = validTimeZone(url.searchParams.get('tz'))

  const supabase = await createClient()
  const settings = await getGamingSettings(supabase, guildId)
  const window = applySettingsRetention(await gamingWindow(guildId, timeframe), settings)

  const [overviewRes, gamesRes, playersRes, dailyRes, heatmapRes, gameDailyRes] =
    await Promise.all([
      fetchOverview(supabase, guildId, window.since, tz),
      fetchGames(supabase, guildId, window.since, tz),
      fetchPlayers(supabase, guildId, window.since),
      fetchDaily(supabase, guildId, window.since, tz),
      fetchHeatmap(supabase, guildId, window.since, tz),
      fetchGameDaily(supabase, guildId, window.since, tz),
    ])

  // Narrowing each result individually (rather than looping) is what lets
  // TypeScript keep the success shapes below — a loop over a mixed union
  // proves nothing about any one of them afterwards.
  if ('error' in overviewRes) return fail(overviewRes.error)
  if ('error' in gamesRes) return fail(gamesRes.error)
  if ('error' in playersRes) return fail(playersRes.error)
  if ('error' in dailyRes) return fail(dailyRes.error)
  if ('error' in heatmapRes) return fail(heatmapRes.error)
  if ('error' in gameDailyRes) return fail(gameDailyRes.error)

  const { overview } = overviewRes
  const { games } = gamesRes
  const { players } = playersRes
  const { daily } = dailyRes
  const { cells } = heatmapRes
  const perGameDaily = gameDailyRes.byGame

  // 'all time' has no comparable previous period, so the trend split is sized
  // from the data that actually came back rather than from a fixed window —
  // the same stance Insights takes for its 'all' timeframe.
  const effectiveDays =
    window.days ??
    (daily.length > 0
      ? Math.max(1, Math.ceil((Date.now() - Date.parse(`${daily[0].day}T00:00:00Z`)) / 86_400_000))
      : 30)

  // The derived half of the module (trends, heatmaps, peaks) is Plus+. Free
  // servers get the raw picture — totals, games, players, live activity — and
  // an empty set here rather than a partially-computed one, so the UI can show
  // a single honest locked state instead of charts with holes in them.
  const advanced = await requireGuildFeature(guildId, 'advancedGamingAnalytics')
  const unlocked = advanced.ok

  const trends = unlocked ? computeGameTrends(perGameDaily, games, effectiveDays) : []
  const insights = computeCommunityInsights(games, players, daily)
  const peaks = unlocked
    ? peakActivity(cells)
    : { peakHour: null, peakHourSeconds: 0, busiestWeekday: null, busiestWeekdaySeconds: 0, weekendShare: 0 }
  const newGames = newlyPlayedGames(games, Math.min(effectiveDays, 14))

  return NextResponse.json({
    enabled: settings.enabled,
    anonymise: settings.anonymizeStats,
    advanced: unlocked,
    requiredPlan: unlocked ? null : advanced.required,
    window: {
      timeframe: window.timeframe,
      days: window.days,
      since: window.since,
      boundBy: window.boundBy,
      planRetentionDays: window.planRetentionDays,
      periodLabel: timeframePeriodLabel(window.timeframe),
      timezone: tz,
    },
    overview,
    games,
    players,
    daily,
    heatmap: unlocked ? cells : [],
    trends,
    insights,
    peaks,
    newGames,
  })
}
