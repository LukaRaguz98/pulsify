import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getGuildLimits } from '@/lib/billing-server'
import {
  timeframeSince,
  timeframeWindowDays,
  type Timeframe,
} from '@/lib/analytics'
import {
  normaliseGamingSettings,
  type CoplayPair,
  type DailyPoint,
  type GameStat,
  type GamingOverview,
  type GamingSettings,
  type HeatmapCell,
  type LiveSession,
  type PlayerStat,
} from '@/lib/gaming'

/**
 * Shared query layer for Gaming Analytics (PULSIFY-64).
 *
 * Every surface — the overview, the rankings, the leaderboards, the exports —
 * reads through the same window helper and the same RPC wrappers. Keeping that
 * in one place is what stops "export everything" from returning more history
 * than the page was allowed to show.
 *
 * The RPCs return snake_case rows shaped by Postgres. Mapping them to the
 * camelCase types in lib/gaming.ts happens here and nowhere else, so the pure
 * engine never sees a database shape and stays testable without a database.
 */

const DAY_MS = 86_400_000

/** Load a guild's gaming configuration, defaulted when the row doesn't exist. */
export async function getGamingSettings(
  supabase: SupabaseClient,
  guildId: string,
): Promise<GamingSettings> {
  const { data } = await supabase
    .from('gaming_settings')
    .select('enabled, settings')
    .eq('guild_id', guildId)
    .maybeSingle()
  return normaliseGamingSettings(data ?? null)
}

export type GamingWindow = {
  /** The timeframe the caller asked for, echoed back for the UI's selector. */
  timeframe: Timeframe
  /** ISO lower bound passed to every RPC, or null for "everything". */
  since: string | null
  /**
   * Days the applied window spans. `null` for an unbounded 'all time' — the
   * same convention `timeframeWindowDays` uses, so the comparison-style views
   * (trends) can tell "no previous period exists" from "a 30-day period".
   */
  days: number | null
  /** Why the window is what it is — the UI explains the limit to the admin. */
  boundBy: 'plan' | 'settings' | 'timeframe' | 'none'
  /** The plan's ceiling, so the UI can offer an upgrade when it is the binding one. */
  planRetentionDays: number
}

/**
 * The effective query window, built exactly the way the rest of the analytics
 * surfaces build theirs: from the shared `Timeframe` in lib/analytics.ts, which
 * Overview, Statistics, Insights and Management all read. Gaming used to invent
 * its own day-count selector; matching the shared one means "last 7 days" is
 * the same 7 days on every analytics page.
 *
 * The plan ceiling is `analyticsRetentionDays` — the analytics limit — NOT
 * `logRetentionDays`, which belongs to [[timeline]]'s server history. Gaming
 * lives under Analytics and is bound by the analytics limit like its siblings.
 *
 * Rows are never deleted: shortening retention hides history, lengthening it or
 * upgrading brings it back. `boundBy` reports which of the three actually bit,
 * because "your chart stops here" is only useful when the admin knows whether
 * to change a setting or a plan.
 */
export async function gamingWindow(
  guildId: string,
  timeframe: Timeframe,
): Promise<GamingWindow> {
  const limits = await getGuildLimits(guildId)
  const planDays = Number.isFinite(limits.analyticsRetentionDays)
    ? limits.analyticsRetentionDays
    : 0

  const requestedDays = timeframeWindowDays(timeframe)

  const candidates: { days: number; source: GamingWindow['boundBy'] }[] = []
  if (planDays > 0) candidates.push({ days: planDays, source: 'plan' })
  if (requestedDays != null && requestedDays > 0) {
    candidates.push({ days: requestedDays, source: 'timeframe' })
  }

  // 'all time' on an unlimited plan: no lower bound at all.
  if (candidates.length === 0) {
    return {
      timeframe,
      since: timeframeSince(timeframe),
      days: null,
      boundBy: 'none',
      planRetentionDays: planDays,
    }
  }

  const winner = candidates.reduce((a, b) => (b.days < a.days ? b : a))
  return {
    timeframe,
    since: new Date(Date.now() - winner.days * DAY_MS).toISOString(),
    days: winner.days,
    boundBy: winner.source,
    planRetentionDays: planDays,
  }
}

/**
 * Fold the guild's own configured retention into the window.
 *
 * This is the one thing Gaming has that the other analytics pages don't, and it
 * is deliberately a PRIVACY control rather than a plan control: a server that
 * wants to keep only 30 days of presence data about its members can say so,
 * independently of what its plan would allow. It can only ever SHORTEN the
 * window — it never overrides the plan ceiling upward.
 *
 * Kept separate from `gamingWindow` because the settings row is already loaded
 * by most callers, and re-reading it per request would double the round trips
 * on a page that fires six queries at once.
 */
export function applySettingsRetention(
  window: GamingWindow,
  settings: GamingSettings,
): GamingWindow {
  const configured = settings.retentionDays
  if (!configured || configured <= 0) return window
  if (window.days != null && window.days <= configured) return window
  return {
    ...window,
    since: new Date(Date.now() - configured * DAY_MS).toISOString(),
    days: configured,
    boundBy: 'settings',
  }
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ── RPC wrappers ─────────────────────────────────────────────────────────

export async function fetchOverview(
  supabase: SupabaseClient,
  guildId: string,
  since: string | null,
  tz: string,
): Promise<{ overview: GamingOverview } | { error: string }> {
  const { data, error } = await supabase.rpc('get_gaming_overview', {
    p_guild_id: guildId,
    p_since: since,
    p_tz: tz,
  })
  if (error) return { error: error.message }

  const row = (data ?? [])[0]
  return {
    overview: {
      totalSeconds: num(row?.total_seconds),
      totalSessions: num(row?.total_sessions),
      uniqueGames: num(row?.unique_games),
      uniquePlayers: num(row?.unique_players),
      activeToday: num(row?.active_today),
      activeWeek: num(row?.active_week),
      currentlyPlaying: num(row?.currently_playing),
      avgSessionSeconds: num(row?.avg_session_seconds),
      longestSeconds: num(row?.longest_seconds),
      firstSessionAt: row?.first_session_at ?? null,
      lastSessionAt: row?.last_session_at ?? null,
    },
  }
}

export async function fetchGames(
  supabase: SupabaseClient,
  guildId: string,
  since: string | null,
  tz: string,
): Promise<{ games: GameStat[] } | { error: string }> {
  const { data, error } = await supabase.rpc('get_gaming_games', {
    p_guild_id: guildId,
    p_since: since,
    p_tz: tz,
  })
  if (error) return { error: error.message }

  return {
    games: (data ?? []).map(
      (r: Record<string, unknown>): GameStat => ({
        gameKey: String(r.game_key ?? ''),
        gameName: String(r.game_name ?? ''),
        applicationId: (r.application_id as string | null) ?? null,
        totalSeconds: num(r.total_seconds),
        totalSessions: num(r.total_sessions),
        uniquePlayers: num(r.unique_players),
        avgSessionSeconds: num(r.avg_session_seconds),
        longestSeconds: num(r.longest_seconds),
        currentlyPlaying: num(r.currently_playing),
        playersToday: num(r.players_today),
        playersWeek: num(r.players_week),
        firstSeenAt: (r.first_seen_at as string | null) ?? null,
        lastSeenAt: (r.last_seen_at as string | null) ?? null,
      }),
    ),
  }
}

export async function fetchPlayers(
  supabase: SupabaseClient,
  guildId: string,
  since: string | null,
): Promise<{ players: PlayerStat[] } | { error: string }> {
  const { data, error } = await supabase.rpc('get_gaming_players', {
    p_guild_id: guildId,
    p_since: since,
  })
  if (error) return { error: error.message }

  return {
    players: (data ?? []).map(
      (r: Record<string, unknown>): PlayerStat => ({
        userId: String(r.user_id ?? ''),
        userName: (r.user_name as string | null) ?? null,
        totalSeconds: num(r.total_seconds),
        totalSessions: num(r.total_sessions),
        uniqueGames: num(r.unique_games),
        avgSessionSeconds: num(r.avg_session_seconds),
        longestSeconds: num(r.longest_seconds),
        currentlyPlaying: Boolean(r.currently_playing),
        favouriteGame: (r.favourite_game as string | null) ?? null,
        favouriteSeconds: num(r.favourite_seconds),
        firstSessionAt: (r.first_session_at as string | null) ?? null,
        lastSessionAt: (r.last_session_at as string | null) ?? null,
      }),
    ),
  }
}

export async function fetchDaily(
  supabase: SupabaseClient,
  guildId: string,
  since: string | null,
  tz: string,
  gameKey?: string | null,
): Promise<{ daily: DailyPoint[] } | { error: string }> {
  const { data, error } = await supabase.rpc('get_gaming_daily', {
    p_guild_id: guildId,
    p_since: since,
    p_tz: tz,
    p_game_key: gameKey ?? null,
  })
  if (error) return { error: error.message }

  return {
    daily: (data ?? []).map(
      (r: Record<string, unknown>): DailyPoint => ({
        day: String(r.day ?? ''),
        totalSeconds: num(r.total_seconds),
        totalSessions: num(r.total_sessions),
        uniquePlayers: num(r.unique_players),
        uniqueGames: num(r.unique_games),
      }),
    ),
  }
}

/**
 * Daily buckets split per game — one query for the whole cube, grouped by key
 * for the trend engine and the per-row sparklines.
 */
export async function fetchGameDaily(
  supabase: SupabaseClient,
  guildId: string,
  since: string | null,
  tz: string,
): Promise<{ byGame: Map<string, DailyPoint[]> } | { error: string }> {
  const { data, error } = await supabase.rpc('get_gaming_game_daily', {
    p_guild_id: guildId,
    p_since: since,
    p_tz: tz,
  })
  if (error) return { error: error.message }

  const byGame = new Map<string, DailyPoint[]>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const key = String(r.game_key ?? '')
    if (!byGame.has(key)) byGame.set(key, [])
    byGame.get(key)!.push({
      day: String(r.day ?? ''),
      totalSeconds: num(r.total_seconds),
      totalSessions: num(r.total_sessions),
      uniquePlayers: num(r.unique_players),
      uniqueGames: 1,
    })
  }
  return { byGame }
}

export async function fetchHeatmap(
  supabase: SupabaseClient,
  guildId: string,
  since: string | null,
  tz: string,
): Promise<{ cells: HeatmapCell[] } | { error: string }> {
  const { data, error } = await supabase.rpc('get_gaming_heatmap', {
    p_guild_id: guildId,
    p_since: since,
    p_tz: tz,
  })
  if (error) return { error: error.message }

  return {
    cells: (data ?? []).map(
      (r: Record<string, unknown>): HeatmapCell => ({
        weekday: num(r.weekday),
        hour: num(r.hour),
        totalSessions: num(r.total_sessions),
        totalSeconds: num(r.total_seconds),
        uniquePlayers: num(r.unique_players),
      }),
    ),
  }
}

export async function fetchCoplay(
  supabase: SupabaseClient,
  guildId: string,
  since: string | null,
  minOverlapSeconds = 900,
  limit = 200,
): Promise<{ pairs: CoplayPair[] } | { error: string }> {
  const { data, error } = await supabase.rpc('get_gaming_coplay', {
    p_guild_id: guildId,
    p_since: since,
    p_min_overlap_seconds: minOverlapSeconds,
    p_limit: limit,
  })
  if (error) return { error: error.message }

  return {
    pairs: (data ?? []).map(
      (r: Record<string, unknown>): CoplayPair => ({
        userA: String(r.user_a ?? ''),
        userAName: (r.user_a_name as string | null) ?? null,
        userB: String(r.user_b ?? ''),
        userBName: (r.user_b_name as string | null) ?? null,
        sharedGames: num(r.shared_games),
        overlapSeconds: num(r.overlap_seconds),
        sessionsTogether: num(r.sessions_together),
        lastTogetherAt: (r.last_together_at as string | null) ?? null,
      }),
    ),
  }
}

/**
 * Open sessions — the live activity feed. A direct table read rather than an
 * RPC: it is a tiny, indexed slice (`gaming_sessions_open`), and the page polls
 * it far more often than anything else here.
 */
export async function fetchLive(
  supabase: SupabaseClient,
  guildId: string,
  limit = 100,
): Promise<{ live: LiveSession[] } | { error: string }> {
  const { data, error } = await supabase
    .from('gaming_sessions')
    .select(
      'id, user_id, user_name, game_name, game_key, started_at, was_streaming, voice_channel_id, voice_channel_name',
    )
    .eq('guild_id', guildId)
    .is('ended_at', null)
    .order('started_at', { ascending: true })
    .limit(limit)

  if (error) return { error: error.message }

  return {
    live: (data ?? []).map(
      (r: Record<string, unknown>): LiveSession => ({
        id: String(r.id ?? ''),
        userId: String(r.user_id ?? ''),
        userName: (r.user_name as string | null) ?? null,
        gameName: String(r.game_name ?? ''),
        gameKey: String(r.game_key ?? ''),
        startedAt: String(r.started_at ?? ''),
        wasStreaming: Boolean(r.was_streaming),
        voiceChannelId: (r.voice_channel_id as string | null) ?? null,
        voiceChannelName: (r.voice_channel_name as string | null) ?? null,
      }),
    ),
  }
}

/**
 * Raw sessions for a member's history and for the export. Bounded by `limit`
 * because "complete gaming history" on a busy server is a genuinely large
 * result set, and an unbounded select would be the one query in this module
 * that could take the page down.
 */
export async function fetchSessions(
  supabase: SupabaseClient,
  guildId: string,
  opts: {
    since: string | null
    userId?: string | null
    gameKey?: string | null
    limit?: number
  },
): Promise<
  | {
      sessions: {
        id: string
        userId: string
        userName: string | null
        gameName: string
        gameKey: string
        startedAt: string
        endedAt: string | null
        durationSeconds: number | null
        source: string
        wasStreaming: boolean
        voiceChannelName: string | null
      }[]
    }
  | { error: string }
> {
  let query = supabase
    .from('gaming_sessions')
    .select(
      'id, user_id, user_name, game_name, game_key, started_at, ended_at, duration_seconds, source, was_streaming, voice_channel_name',
    )
    .eq('guild_id', guildId)
    .order('started_at', { ascending: false })
    .limit(Math.min(opts.limit ?? 500, 10_000))

  if (opts.since) query = query.gte('started_at', opts.since)
  if (opts.userId) query = query.eq('user_id', opts.userId)
  if (opts.gameKey) query = query.eq('game_key', opts.gameKey)

  const { data, error } = await query
  if (error) return { error: error.message }

  return {
    sessions: (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id ?? ''),
      userId: String(r.user_id ?? ''),
      userName: (r.user_name as string | null) ?? null,
      gameName: String(r.game_name ?? ''),
      gameKey: String(r.game_key ?? ''),
      startedAt: String(r.started_at ?? ''),
      endedAt: (r.ended_at as string | null) ?? null,
      durationSeconds: r.duration_seconds == null ? null : num(r.duration_seconds),
      source: String(r.source ?? 'presence'),
      wasStreaming: Boolean(r.was_streaming),
      voiceChannelName: (r.voice_channel_name as string | null) ?? null,
    })),
  }
}
