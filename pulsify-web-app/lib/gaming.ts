/**
 * Gaming Analytics — client-safe types, constants and the pure engine
 * (PULSIFY-64).
 *
 * The bot turns Discord presence transitions into rows in `gaming_sessions`;
 * six SQL aggregates (see 20260629_gaming_analytics.sql) collapse those rows
 * into per-game, per-member, per-day and per-hour totals. Everything in THIS
 * file is the layer above: it takes those aggregates and derives the things SQL
 * shouldn't — growth comparisons, squads, community insights, rankings.
 *
 * NO `server-only`: the dashboard sorts, filters and re-ranks in the browser
 * without a round trip, and the export builders run on both sides. Database
 * reads live in `lib/gaming-query.ts`.
 *
 * Every function here is PURE. That is deliberate — the interesting logic in
 * this module is arithmetic about time, and arithmetic about time is where
 * analytics quietly goes wrong. Pure functions are the part we can test.
 */

// ── Settings ─────────────────────────────────────────────────────────────
// Mirror of DEFAULT_CONFIG / normaliseGamingSettings in pulse-bot/src/gaming.js.
// Keep the two in sync — the bot enforces these at write time, the dashboard
// edits them, and a drift between the two means the UI promises a rule the
// collector isn't applying.

export type GamingSettings = {
  enabled: boolean
  ignoredRoles: string[]
  ignoredMembers: string[]
  ignoredGames: string[]
  retentionDays: number
  anonymizeStats: boolean
  allowMemberOptOut: boolean
  minSessionSeconds: number
  trackCompeting: boolean
}

export const DEFAULT_GAMING_SETTINGS: GamingSettings = {
  enabled: false,
  ignoredRoles: [],
  ignoredMembers: [],
  ignoredGames: [],
  retentionDays: 90,
  anonymizeStats: false,
  allowMemberOptOut: true,
  // Two minutes: below that you are alt-tabbing through a launcher, not
  // playing. The bot DELETES sessions under this threshold rather than storing
  // them, so raising it does not retroactively clean up history.
  minSessionSeconds: 120,
  trackCompeting: true,
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function strArray(v: unknown): string[] {
  // Nullish entries are dropped before stringifying — String(null) is "null",
  // which survives a truthiness filter and becomes a literal "null" id.
  // Mirrors toStringArray in pulse-bot/src/gaming.js.
  return Array.isArray(v)
    ? v.filter((x) => x != null).map((x) => String(x)).filter(Boolean)
    : []
}

/** Row shape as stored: `{ enabled, settings }` with a snake_case jsonb blob. */
export function normaliseGamingSettings(row: {
  enabled?: boolean | null
  settings?: Record<string, unknown> | null
} | null): GamingSettings {
  const base = DEFAULT_GAMING_SETTINGS
  if (!row) return { ...base }
  const s = (row.settings ?? {}) as Record<string, unknown>
  const bool = (v: unknown, d: boolean) => (v == null ? d : Boolean(v))
  return {
    enabled: typeof row.enabled === 'boolean' ? row.enabled : base.enabled,
    ignoredRoles: strArray(s.ignored_roles),
    ignoredMembers: strArray(s.ignored_members),
    ignoredGames: strArray(s.ignored_games),
    retentionDays: clampInt(s.retention_days, 0, 3650, base.retentionDays),
    anonymizeStats: bool(s.anonymize_stats, base.anonymizeStats),
    allowMemberOptOut: bool(s.allow_member_opt_out, base.allowMemberOptOut),
    minSessionSeconds: clampInt(s.min_session_seconds, 0, 3600, base.minSessionSeconds),
    trackCompeting: bool(s.track_competing, base.trackCompeting),
  }
}

/** Back to the jsonb shape the bot reads. */
export function serialiseGamingSettings(s: GamingSettings): Record<string, unknown> {
  return {
    ignored_roles: s.ignoredRoles,
    ignored_members: s.ignoredMembers,
    ignored_games: s.ignoredGames,
    retention_days: s.retentionDays,
    anonymize_stats: s.anonymizeStats,
    allow_member_opt_out: s.allowMemberOptOut,
    min_session_seconds: s.minSessionSeconds,
    track_competing: s.trackCompeting,
  }
}

/** Normalised grouping key — must match gameKeyOf() in pulse-bot/src/gaming.js. */
export function gameKey(name: string): string {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// ── Aggregate row shapes (mirrors of the RPC return tables) ──────────────

export type GamingOverview = {
  totalSeconds: number
  totalSessions: number
  uniqueGames: number
  uniquePlayers: number
  activeToday: number
  activeWeek: number
  currentlyPlaying: number
  avgSessionSeconds: number
  longestSeconds: number
  firstSessionAt: string | null
  lastSessionAt: string | null
}

export type GameStat = {
  gameKey: string
  gameName: string
  applicationId: string | null
  totalSeconds: number
  totalSessions: number
  uniquePlayers: number
  avgSessionSeconds: number
  longestSeconds: number
  currentlyPlaying: number
  playersToday: number
  playersWeek: number
  firstSeenAt: string | null
  lastSeenAt: string | null
}

export type PlayerStat = {
  userId: string
  userName: string | null
  totalSeconds: number
  totalSessions: number
  uniqueGames: number
  avgSessionSeconds: number
  longestSeconds: number
  currentlyPlaying: boolean
  favouriteGame: string | null
  favouriteSeconds: number
  firstSessionAt: string | null
  lastSessionAt: string | null
}

export type DailyPoint = {
  day: string
  totalSeconds: number
  totalSessions: number
  uniquePlayers: number
  uniqueGames: number
}

export type HeatmapCell = {
  weekday: number
  hour: number
  totalSessions: number
  totalSeconds: number
  uniquePlayers: number
}

export type CoplayPair = {
  userA: string
  userAName: string | null
  userB: string
  userBName: string | null
  sharedGames: number
  overlapSeconds: number
  sessionsTogether: number
  lastTogetherAt: string | null
}

export type LiveSession = {
  id: string
  userId: string
  userName: string | null
  gameName: string
  gameKey: string
  startedAt: string
  wasStreaming: boolean
  voiceChannelId: string | null
  voiceChannelName: string | null
}

// ── Formatting ───────────────────────────────────────────────────────────

/**
 * "3h 42m" / "48m" / "35s". Mirrors formatDuration in pulse-bot/src/gaming.js
 * so a number quoted in Discord reads identically on the dashboard.
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  if (s < 60) return `${s}s`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Compact hours for stat tiles, where "1,284h" beats "1284h 17m". */
export function formatHours(seconds: number): string {
  const h = Math.round((Number(seconds) || 0) / 3600)
  return `${h.toLocaleString()}h`
}

// ── Sorting ──────────────────────────────────────────────────────────────

export const GAME_SORTS = ['playtime', 'players', 'sessions', 'popularity', 'alphabetical'] as const
export type GameSort = (typeof GAME_SORTS)[number]

export const GAME_SORT_LABELS: Record<GameSort, string> = {
  playtime: 'Playtime',
  players: 'Players',
  sessions: 'Sessions',
  popularity: 'Popularity',
  alphabetical: 'A–Z',
}

/**
 * "Popularity" is deliberately not a synonym for playtime. A game two people
 * sank 200 hours into is not more popular than one twenty people played for an
 * hour — it is more *played*. Popularity weights breadth (how many members
 * chose it) against depth (how long they stayed), so the ranking answers "what
 * is this community into" rather than "who has the most free time".
 */
export function popularityScore(g: GameStat): number {
  const hours = g.totalSeconds / 3600
  return g.uniquePlayers * Math.sqrt(Math.max(hours, 0))
}

export function sortGames(games: GameStat[], sort: GameSort): GameStat[] {
  const out = [...games]
  switch (sort) {
    case 'players':
      out.sort((a, b) => b.uniquePlayers - a.uniquePlayers || b.totalSeconds - a.totalSeconds)
      break
    case 'sessions':
      out.sort((a, b) => b.totalSessions - a.totalSessions || b.totalSeconds - a.totalSeconds)
      break
    case 'popularity':
      out.sort((a, b) => popularityScore(b) - popularityScore(a))
      break
    case 'alphabetical':
      out.sort((a, b) => a.gameName.localeCompare(b.gameName))
      break
    case 'playtime':
    default:
      out.sort((a, b) => b.totalSeconds - a.totalSeconds)
  }
  return out
}

// ── Trends ───────────────────────────────────────────────────────────────

export type GameTrend = {
  game: GameStat
  /** Seconds in the recent half of the window. */
  currentSeconds: number
  /** Seconds in the older half. */
  previousSeconds: number
  /** −1 … +∞. `null` when there is no previous activity to compare against. */
  changeRatio: number | null
  direction: 'rising' | 'falling' | 'steady' | 'new'
}

/**
 * Split a daily series down the middle and compare the halves.
 *
 * This is the same window-split technique [[insights]] uses, and it is chosen
 * for the same reason: it needs no stored history and no second query, so a
 * server that enabled the module yesterday still gets a trend today. The cost
 * is that "growth" is relative to the window you are looking at — doubling the
 * range changes the answer. The UI labels the window for exactly that reason.
 *
 * A game with no activity in the older half is `new`, not infinitely rising:
 * dividing by zero would put every first-time game at the top of "fastest
 * growing" forever, which is noise, not insight.
 */
export function computeGameTrends(
  perGameDaily: Map<string, DailyPoint[]>,
  games: GameStat[],
  windowDays: number,
): GameTrend[] {
  const halfway = Date.now() - (windowDays / 2) * 86_400_000

  return games.map((game) => {
    const series = perGameDaily.get(game.gameKey) ?? []
    let currentSeconds = 0
    let previousSeconds = 0
    for (const point of series) {
      const t = Date.parse(`${point.day}T00:00:00Z`)
      if (Number.isNaN(t)) continue
      if (t >= halfway) currentSeconds += point.totalSeconds
      else previousSeconds += point.totalSeconds
    }

    let direction: GameTrend['direction']
    let changeRatio: number | null
    if (previousSeconds === 0) {
      changeRatio = null
      direction = currentSeconds > 0 ? 'new' : 'steady'
    } else {
      changeRatio = (currentSeconds - previousSeconds) / previousSeconds
      // A ±10% band keeps normal week-to-week wobble out of the rising/falling
      // lists, which are meant to surface real movement.
      direction = changeRatio > 0.1 ? 'rising' : changeRatio < -0.1 ? 'falling' : 'steady'
    }

    return { game, currentSeconds, previousSeconds, changeRatio, direction }
  })
}

/** Games first seen inside the last `days` — the "newly played" list. */
export function newlyPlayedGames(games: GameStat[], days: number): GameStat[] {
  const cutoff = Date.now() - days * 86_400_000
  return games
    .filter((g) => g.firstSeenAt != null && Date.parse(g.firstSeenAt) >= cutoff)
    .sort((a, b) => Date.parse(b.firstSeenAt ?? '') - Date.parse(a.firstSeenAt ?? ''))
}

// ── Heatmaps ─────────────────────────────────────────────────────────────

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * The RPC returns only the buckets that have data. A heatmap needs all 168
 * cells, including the empty ones — a gap in the grid is information ("nobody
 * plays at 6am"), and rendering a sparse array would silently shift columns.
 */
export function denseHeatmap(cells: HeatmapCell[]): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const cell of cells) {
    if (cell.weekday < 0 || cell.weekday > 6 || cell.hour < 0 || cell.hour > 23) continue
    grid[cell.weekday][cell.hour] = cell.totalSeconds
  }
  return grid
}

export type PeakActivity = {
  peakHour: number | null
  peakHourSeconds: number
  busiestWeekday: number | null
  busiestWeekdaySeconds: number
  weekendShare: number
}

/** Peak hour, busiest weekday, and how much of the playtime is weekend. */
export function peakActivity(cells: HeatmapCell[]): PeakActivity {
  const byHour = Array(24).fill(0) as number[]
  const byWeekday = Array(7).fill(0) as number[]
  for (const cell of cells) {
    if (cell.hour >= 0 && cell.hour < 24) byHour[cell.hour] += cell.totalSeconds
    if (cell.weekday >= 0 && cell.weekday < 7) byWeekday[cell.weekday] += cell.totalSeconds
  }

  const total = byWeekday.reduce((a, b) => a + b, 0)
  const weekend = byWeekday[0] + byWeekday[6]

  const maxHour = Math.max(...byHour)
  const maxDay = Math.max(...byWeekday)

  return {
    peakHour: maxHour > 0 ? byHour.indexOf(maxHour) : null,
    peakHourSeconds: maxHour,
    busiestWeekday: maxDay > 0 ? byWeekday.indexOf(maxDay) : null,
    busiestWeekdaySeconds: maxDay,
    weekendShare: total > 0 ? weekend / total : 0,
  }
}

/**
 * Average concurrent players over the window.
 *
 * Honest about its own limits: sessions are bucketed by START hour (see the
 * heatmap RPC), so this is total playtime divided by elapsed wall-clock time —
 * a mean, not a peak. It answers "how busy is this server on average", and the
 * UI must not label it "peak concurrent players", which it is not.
 */
export function averageConcurrent(totalSeconds: number, windowDays: number): number {
  const windowSeconds = Math.max(1, windowDays * 86_400)
  return totalSeconds / windowSeconds
}

// ── Squads ───────────────────────────────────────────────────────────────

export type Squad = {
  id: string
  members: { userId: string; userName: string | null }[]
  sharedGames: number
  overlapSeconds: number
  sessionsTogether: number
  lastTogetherAt: string | null
}

/**
 * Group co-play PAIRS into squads.
 *
 * The SQL returns pairs because pairs are what a self-join can produce. A squad
 * is a connected component of that graph: if A plays with B and B plays with C,
 * the three of them are one group even when A and C have never overlapped
 * directly. Union-find over the pair list gives exactly that, in one pass.
 *
 * This is intentionally NOT clique detection. Requiring everyone to have played
 * with everyone else would break up real friend groups the moment one member
 * missed a night, which is the opposite of useful.
 */
export function buildSquads(pairs: CoplayPair[], minMembers = 2): Squad[] {
  const parent = new Map<string, string>()
  const names = new Map<string, string | null>()

  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root) ?? root
    // Path compression keeps repeated lookups flat on big servers.
    let cur = x
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) ?? root
      parent.set(cur, root)
      cur = next
    }
    return root
  }

  const add = (id: string, name: string | null) => {
    if (!parent.has(id)) parent.set(id, id)
    if (name && !names.get(id)) names.set(id, name)
  }

  for (const p of pairs) {
    add(p.userA, p.userAName)
    add(p.userB, p.userBName)
    const ra = find(p.userA)
    const rb = find(p.userB)
    if (ra !== rb) parent.set(ra, rb)
  }

  const groups = new Map<string, Squad>()
  for (const p of pairs) {
    const root = find(p.userA)
    let squad = groups.get(root)
    if (!squad) {
      squad = {
        id: root,
        members: [],
        sharedGames: 0,
        overlapSeconds: 0,
        sessionsTogether: 0,
        lastTogetherAt: null,
      }
      groups.set(root, squad)
    }
    squad.overlapSeconds += p.overlapSeconds
    squad.sessionsTogether += p.sessionsTogether
    squad.sharedGames = Math.max(squad.sharedGames, p.sharedGames)
    if (
      p.lastTogetherAt &&
      (!squad.lastTogetherAt || p.lastTogetherAt > squad.lastTogetherAt)
    ) {
      squad.lastTogetherAt = p.lastTogetherAt
    }
  }

  // Members are collected after the union pass so everyone lands in their final
  // component rather than the one they were first seen in.
  const membersByRoot = new Map<string, Set<string>>()
  for (const id of parent.keys()) {
    const root = find(id)
    if (!membersByRoot.has(root)) membersByRoot.set(root, new Set())
    membersByRoot.get(root)!.add(id)
  }

  const out: Squad[] = []
  for (const [root, squad] of groups) {
    const ids = [...(membersByRoot.get(root) ?? [])]
    if (ids.length < minMembers) continue
    squad.members = ids.map((id) => ({ userId: id, userName: names.get(id) ?? null }))
    out.push(squad)
  }

  return out.sort((a, b) => b.overlapSeconds - a.overlapSeconds)
}

// ── Community insights ───────────────────────────────────────────────────

export type CommunityInsights = {
  avgGamesPerMember: number
  avgDailySeconds: number
  gameDiversity: number
  returningPlayers: number
  newlyActivePlayers: number
  inactivePlayers: number
  mostSocialGame: GameStat | null
  mostCommittedGame: GameStat | null
}

/**
 * Community-level statistics derived from the per-game and per-member
 * aggregates. Two of these need their definitions stated, because the obvious
 * reading is the wrong one:
 *
 *   • "Most social" is the game with the highest players-per-session ratio —
 *     a game many different members keep coming back to, not simply the one
 *     with the most players overall (that is just the most popular game again).
 *   • "Most committed" replaces the ticket's "most competitive". Presence
 *     cannot tell competition from co-operation — Discord reports a game name,
 *     not a game mode — so the honest metric is the longest average session:
 *     the game this server sinks its evenings into. Labelling it "competitive"
 *     would be inventing data we do not have.
 *
 * `gameDiversity` is normalised Shannon entropy over playtime share: 0 when the
 * server plays exactly one game, 1 when playtime is spread evenly across all of
 * them. It is scale-free, so a 20-member server and a 2000-member one can be
 * compared directly.
 */
export function computeCommunityInsights(
  games: GameStat[],
  players: PlayerStat[],
  daily: DailyPoint[],
): CommunityInsights {
  const totalSeconds = games.reduce((sum, g) => sum + g.totalSeconds, 0)

  const avgGamesPerMember =
    players.length > 0 ? players.reduce((s, p) => s + p.uniqueGames, 0) / players.length : 0

  const activeDays = new Set(daily.filter((d) => d.totalSeconds > 0).map((d) => d.day)).size
  const avgDailySeconds = activeDays > 0 ? totalSeconds / activeDays : 0

  // Normalised Shannon entropy over each game's share of total playtime.
  let diversity = 0
  if (totalSeconds > 0 && games.length > 1) {
    let entropy = 0
    for (const g of games) {
      const share = g.totalSeconds / totalSeconds
      if (share > 0) entropy -= share * Math.log(share)
    }
    diversity = entropy / Math.log(games.length)
  }

  const weekAgo = Date.now() - 7 * 86_400_000
  const monthAgo = Date.now() - 30 * 86_400_000

  const returningPlayers = players.filter(
    (p) =>
      p.totalSessions > 1 &&
      p.lastSessionAt != null &&
      Date.parse(p.lastSessionAt) >= weekAgo,
  ).length

  const newlyActivePlayers = players.filter(
    (p) => p.firstSessionAt != null && Date.parse(p.firstSessionAt) >= weekAgo,
  ).length

  const inactivePlayers = players.filter(
    (p) => p.lastSessionAt != null && Date.parse(p.lastSessionAt) < monthAgo,
  ).length

  const social = games.filter((g) => g.totalSessions > 0)
  const mostSocialGame =
    social.length > 0
      ? social.reduce((best, g) =>
          g.uniquePlayers / g.totalSessions > best.uniquePlayers / best.totalSessions ? g : best,
        )
      : null

  const committed = games.filter((g) => g.avgSessionSeconds > 0)
  const mostCommittedGame =
    committed.length > 0
      ? committed.reduce((best, g) => (g.avgSessionSeconds > best.avgSessionSeconds ? g : best))
      : null

  return {
    avgGamesPerMember,
    avgDailySeconds,
    gameDiversity: diversity,
    returningPlayers,
    newlyActivePlayers,
    inactivePlayers,
    mostSocialGame,
    mostCommittedGame,
  }
}

// ── Leaderboards ─────────────────────────────────────────────────────────

export const LEADERBOARDS = [
  'playtime',
  'sessions',
  'avgSession',
  'longestSession',
  'variety',
] as const
export type LeaderboardKey = (typeof LEADERBOARDS)[number]

export const LEADERBOARD_LABELS: Record<LeaderboardKey, string> = {
  playtime: 'Playtime',
  sessions: 'Total sessions',
  avgSession: 'Average session',
  longestSession: 'Longest session',
  variety: 'Different games',
}

export type LeaderboardRow = {
  rank: number
  player: PlayerStat
  value: number
  display: string
}

export function buildLeaderboard(
  players: PlayerStat[],
  board: LeaderboardKey,
  limit = 50,
): LeaderboardRow[] {
  const pick: Record<LeaderboardKey, (p: PlayerStat) => number> = {
    playtime: (p) => p.totalSeconds,
    sessions: (p) => p.totalSessions,
    avgSession: (p) => p.avgSessionSeconds,
    longestSession: (p) => p.longestSeconds,
    variety: (p) => p.uniqueGames,
  }
  const show: Record<LeaderboardKey, (p: PlayerStat) => string> = {
    playtime: (p) => formatDuration(p.totalSeconds),
    sessions: (p) => `${p.totalSessions.toLocaleString()}`,
    avgSession: (p) => formatDuration(p.avgSessionSeconds),
    longestSession: (p) => formatDuration(p.longestSeconds),
    variety: (p) => `${p.uniqueGames}`,
  }

  return [...players]
    .filter((p) => pick[board](p) > 0)
    .sort((a, b) => pick[board](b) - pick[board](a))
    .slice(0, limit)
    .map((player, i) => ({
      rank: i + 1,
      player,
      value: pick[board](player),
      display: show[board](player),
    }))
}

/**
 * Anonymised display name. When a server turns on `anonymizeStats`, aggregate
 * views must not leak who played what — but the rank itself is still useful, so
 * members become positional labels rather than disappearing.
 */
export function displayName(
  player: { userId: string; userName: string | null },
  anonymise: boolean,
  rank?: number,
): string {
  if (!anonymise) return player.userName ?? 'Unknown member'
  return rank != null ? `Player ${rank}` : 'Anonymous player'
}

/**
 * Identity stripped from the ROWS, not just from the label.
 *
 * `displayName` hides a name at render time, which is enough for the admin
 * views — the admin is allowed to know who these people are. It is NOT enough
 * for the member-facing view: shipping real user ids to every member and
 * printing "Player 3" over them would make the anonymity a CSS effect. These
 * two helpers run server-side, before the payload leaves, and replace the id
 * with a positional placeholder that matches the rank the UI will print.
 */
export function anonymisePlayerStats(players: PlayerStat[]): PlayerStat[] {
  return players.map((p, i) => ({ ...p, userId: `anon-${i + 1}`, userName: null }))
}

export function anonymiseLiveSessions(live: LiveSession[]): LiveSession[] {
  return live.map((s, i) => ({ ...s, userId: `anon-${i + 1}`, userName: null }))
}

// ── Gaming streaks ───────────────────────────────────────────────────────

/**
 * Longest and current run of consecutive days with at least one session.
 *
 * Days come from the caller already bucketed in the guild's timezone, so this
 * never has to reason about offsets — it only walks dates. "Current" tolerates
 * today being empty (the day is not over yet); a gap of two days breaks it.
 */
export function computeStreak(days: string[]): { current: number; longest: number } {
  if (days.length === 0) return { current: 0, longest: 0 }

  const unique = [...new Set(days)].sort()
  let longest = 1
  let run = 1

  for (let i = 1; i < unique.length; i += 1) {
    const prev = Date.parse(`${unique[i - 1]}T00:00:00Z`)
    const cur = Date.parse(`${unique[i]}T00:00:00Z`)
    const gap = Math.round((cur - prev) / 86_400_000)
    if (gap === 1) {
      run += 1
      longest = Math.max(longest, run)
    } else {
      run = 1
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const last = unique[unique.length - 1]
  const current = last === today || last === yesterday ? run : 0

  return { current, longest }
}
