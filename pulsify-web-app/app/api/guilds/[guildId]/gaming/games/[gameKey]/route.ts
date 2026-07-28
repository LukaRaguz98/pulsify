import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import {
  applySettingsRetention,
  fetchDaily,
  fetchGames,
  fetchSessions,
  gamingWindow,
  getGamingSettings,
} from '@/lib/gaming-query'
import { isTimeframe, type Timeframe } from '@/lib/analytics'

/**
 * GET /api/guilds/[guildId]/gaming/games/[gameKey]
 *
 * One game's detail page: server totals, its players ranked, first detected
 * date, and the daily series the daily/weekly/monthly trend charts are drawn
 * from.
 *
 * `gameKey` is the normalised key (lowercase, collapsed whitespace) rather than
 * the display name — the same key the bot writes and every aggregate groups by,
 * so "PUBG" and "pubg" resolve to one page instead of two.
 */

const DEFAULT_TIMEFRAME: Timeframe = '30d'
const SESSION_LIMIT = 2000

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string; gameKey: string }> },
) {
  const { guildId, gameKey } = await params
  const key = decodeURIComponent(gameKey)

  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const tfParam = url.searchParams.get('timeframe')
  const timeframe: Timeframe = isTimeframe(tfParam) ? tfParam : DEFAULT_TIMEFRAME
  const tz = url.searchParams.get('tz') || 'UTC'

  const supabase = await createClient()
  const settings = await getGamingSettings(supabase, guildId)
  const window = applySettingsRetention(await gamingWindow(guildId, timeframe), settings)

  const [gamesRes, dailyRes, sessionsRes] = await Promise.all([
    fetchGames(supabase, guildId, window.since, tz),
    fetchDaily(supabase, guildId, window.since, tz, key),
    fetchSessions(supabase, guildId, { since: window.since, gameKey: key, limit: SESSION_LIMIT }),
  ])

  if ('error' in gamesRes) {
    return NextResponse.json({ error: `Game detail failed: ${gamesRes.error}` }, { status: 500 })
  }
  if ('error' in dailyRes) {
    return NextResponse.json({ error: `Game detail failed: ${dailyRes.error}` }, { status: 500 })
  }
  if ('error' in sessionsRes) {
    return NextResponse.json({ error: `Game detail failed: ${sessionsRes.error}` }, { status: 500 })
  }

  const game = gamesRes.games.find((g) => g.gameKey === key)
  if (!game) {
    return NextResponse.json({ error: 'No tracked sessions for this game.' }, { status: 404 })
  }

  // Per-player totals for this game, from the game's own sessions.
  const byPlayer = new Map<
    string,
    { userId: string; userName: string | null; seconds: number; sessions: number; lastPlayedAt: string }
  >()
  for (const s of sessionsRes.sessions) {
    const seconds =
      s.durationSeconds ?? Math.max(0, (Date.now() - Date.parse(s.startedAt)) / 1000)
    const entry = byPlayer.get(s.userId)
    if (entry) {
      entry.seconds += seconds
      entry.sessions += 1
      if (s.startedAt > entry.lastPlayedAt) entry.lastPlayedAt = s.startedAt
    } else {
      byPlayer.set(s.userId, {
        userId: s.userId,
        userName: s.userName,
        seconds,
        sessions: 1,
        lastPlayedAt: s.startedAt,
      })
    }
  }

  const players = [...byPlayer.values()].sort((a, b) => b.seconds - a.seconds)

  return NextResponse.json({
    anonymise: settings.anonymizeStats,
    window: { timeframe: window.timeframe, days: window.days, since: window.since, timezone: tz },
    game,
    players,
    daily: dailyRes.daily,
    recentSessions: sessionsRes.sessions.slice(0, 25),
  })
}
