import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import {
  applySettingsRetention,
  fetchDaily,
  fetchPlayers,
  fetchSessions,
  gamingWindow,
  getGamingSettings,
} from '@/lib/gaming-query'
import { isTimeframe, type Timeframe } from '@/lib/analytics'
import { computeStreak, gameKey as toGameKey } from '@/lib/gaming'

/**
 * GET /api/guilds/[guildId]/gaming/players/[userId]
 *
 * One member's gaming profile: totals, favourite game, recently played, longest
 * and average session, streak, per-game breakdown and raw history.
 *
 * The per-game breakdown and the streak are derived from the member's own
 * sessions rather than from another aggregate — a profile is the one place
 * where reading every row for a single member is both cheap and necessary.
 *
 * An opted-out member returns 404 rather than an empty profile: the module
 * deletes nothing on opt-out by default, and rendering "0 hours" for someone
 * who explicitly withdrew would invite the wrong conclusion.
 */

const DEFAULT_TIMEFRAME: Timeframe = '30d'
const HISTORY_LIMIT = 500

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string; userId: string }> },
) {
  const { guildId, userId } = await params

  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const tfParam = url.searchParams.get('timeframe')
  const timeframe: Timeframe = isTimeframe(tfParam) ? tfParam : DEFAULT_TIMEFRAME
  const tz = url.searchParams.get('tz') || 'UTC'

  const supabase = await createClient()
  const settings = await getGamingSettings(supabase, guildId)
  const window = applySettingsRetention(await gamingWindow(guildId, timeframe), settings)

  const { data: optOut } = await supabase
    .from('gaming_opt_outs')
    .select('user_id')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle()

  if (optOut) {
    return NextResponse.json(
      { error: 'This member has opted out of gaming tracking.', optedOut: true },
      { status: 404 },
    )
  }

  const [playersRes, sessionsRes, dailyRes] = await Promise.all([
    fetchPlayers(supabase, guildId, window.since),
    fetchSessions(supabase, guildId, {
      since: window.since,
      userId,
      limit: HISTORY_LIMIT,
    }),
    fetchDaily(supabase, guildId, window.since, tz),
  ])

  if ('error' in playersRes) {
    return NextResponse.json({ error: `Profile failed: ${playersRes.error}` }, { status: 500 })
  }
  if ('error' in sessionsRes) {
    return NextResponse.json({ error: `Profile failed: ${sessionsRes.error}` }, { status: 500 })
  }
  if ('error' in dailyRes) {
    return NextResponse.json({ error: `Profile failed: ${dailyRes.error}` }, { status: 500 })
  }

  const ranked = [...playersRes.players].sort((a, b) => b.totalSeconds - a.totalSeconds)
  const player = ranked.find((p) => p.userId === userId)

  if (!player) {
    return NextResponse.json(
      { error: 'No tracked gaming activity for this member.', empty: true },
      { status: 404 },
    )
  }

  const rank = ranked.findIndex((p) => p.userId === userId) + 1
  const sessions = sessionsRes.sessions

  // Per-game totals for this member, newest spelling of the name winning.
  const byGame = new Map<
    string,
    { gameKey: string; gameName: string; seconds: number; sessions: number; lastPlayedAt: string }
  >()
  for (const s of sessions) {
    const key = s.gameKey || toGameKey(s.gameName)
    const seconds =
      s.durationSeconds ?? Math.max(0, (Date.now() - Date.parse(s.startedAt)) / 1000)
    const entry = byGame.get(key)
    if (entry) {
      entry.seconds += seconds
      entry.sessions += 1
      if (s.startedAt > entry.lastPlayedAt) entry.lastPlayedAt = s.startedAt
    } else {
      byGame.set(key, {
        gameKey: key,
        gameName: s.gameName,
        seconds,
        sessions: 1,
        lastPlayedAt: s.startedAt,
      })
    }
  }

  const games = [...byGame.values()].sort((a, b) => b.seconds - a.seconds)

  // Streak days come from the member's own sessions bucketed in the display
  // timezone — the same bucketing the daily chart uses, so the two agree.
  const dayKey = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso))
  const streak = computeStreak(sessions.map((s) => dayKey(s.startedAt)))

  const monthAgo = Date.now() - 30 * 86_400_000
  const gamesThisMonth = new Set(
    sessions.filter((s) => Date.parse(s.startedAt) >= monthAgo).map((s) => s.gameKey),
  ).size

  // Which hours this member plays in — the profile's "most active hours".
  const hours = Array(24).fill(0) as number[]
  for (const s of sessions) {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(
        new Date(s.startedAt),
      ),
    )
    if (Number.isFinite(hour) && hour >= 0 && hour < 24) {
      hours[hour] += s.durationSeconds ?? 0
    }
  }

  return NextResponse.json({
    anonymise: settings.anonymizeStats,
    window: { timeframe: window.timeframe, days: window.days, since: window.since, timezone: tz },
    player,
    rank,
    totalRanked: ranked.length,
    games,
    recentSessions: sessions.slice(0, 25),
    sessionCount: sessions.length,
    streak,
    gamesThisMonth,
    hours,
  })
}
