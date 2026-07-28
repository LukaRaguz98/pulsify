import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { requireGuildFeature } from '@/lib/billing-server'
import { fetchGuild } from '@/lib/discord'
import { renderPdf, type PdfBlock, type PdfDocument } from '@/lib/pdf'
import {
  applySettingsRetention,
  fetchGames,
  fetchPlayers,
  fetchSessions,
  gamingWindow,
  getGamingSettings,
} from '@/lib/gaming-query'
import { isTimeframe, timeframePeriodLabel, type Timeframe } from '@/lib/analytics'
import {
  buildLeaderboard,
  displayName,
  formatDuration,
  LEADERBOARD_LABELS,
  LEADERBOARDS,
  type GameStat,
  type PlayerStat,
} from '@/lib/gaming'

/**
 * GET /api/guilds/[guildId]/gaming/export
 *
 * Gaming analytics as CSV, JSON or PDF.
 *
 * `dataset` picks what to export:
 *   players  — per-member statistics
 *   games    — per-game statistics
 *   leaderboards — every board, ranked (PDF/JSON only; CSV flattens to rows)
 *   sessions — the complete gaming history, session by session
 *
 * The window is the same one the dashboard is bound by, so an export can never
 * return more history than the page was allowed to show. `anonymizeStats`
 * is honoured here too — an export is the easiest way to leak exactly what that
 * setting exists to hide.
 */

type Dataset = 'players' | 'games' | 'leaderboards' | 'sessions'
type Format = 'csv' | 'json' | 'pdf'

const DEFAULT_TIMEFRAME: Timeframe = '30d'
const SESSION_LIMIT = 10_000

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params

  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  // Exports ride the same gate as the other derived views — reading the
  // dashboard is free, taking the data away is not.
  const gate = await requireGuildFeature(guildId, 'advancedGamingAnalytics')
  if (!gate.ok) {
    return Response.json(
      { error: gate.error, locked: true, current: gate.current, required: gate.required },
      { status: 402 },
    )
  }

  const url = new URL(req.url)
  const format = (url.searchParams.get('format') ?? 'csv') as Format
  const dataset = (url.searchParams.get('dataset') ?? 'players') as Dataset
  if (!['csv', 'json', 'pdf'].includes(format)) {
    return Response.json({ error: 'Unsupported format.' }, { status: 400 })
  }
  if (!['players', 'games', 'leaderboards', 'sessions'].includes(dataset)) {
    return Response.json({ error: 'Unsupported dataset.' }, { status: 400 })
  }

  const tfParam = url.searchParams.get('timeframe')
  const timeframe: Timeframe = isTimeframe(tfParam) ? tfParam : DEFAULT_TIMEFRAME
  const tz = url.searchParams.get('tz') || 'UTC'

  const supabase = await createClient()
  const settings = await getGamingSettings(supabase, guildId)
  const window = applySettingsRetention(await gamingWindow(guildId, timeframe), settings)
  const anonymise = settings.anonymizeStats

  const guild = await fetchGuild(guildId)
  const guildName = guild?.name ?? 'Server'
  const filename = exportFilename(guildName, dataset, format)

  // Printed on the export itself, in the same words the dashboard used.
  const scope = `${dataset} — ${timeframePeriodLabel(window.timeframe)}`

  if (dataset === 'sessions') {
    const res = await fetchSessions(supabase, guildId, {
      since: window.since,
      limit: SESSION_LIMIT,
    })
    if ('error' in res) return Response.json({ error: res.error }, { status: 500 })

    const rows = res.sessions.map((s, i) => ({
      member: anonymise ? `Player ${i + 1}` : (s.userName ?? s.userId),
      game: s.gameName,
      started: s.startedAt,
      ended: s.endedAt ?? '',
      duration_seconds: s.durationSeconds ?? '',
      duration: s.durationSeconds == null ? 'in progress' : formatDuration(s.durationSeconds),
      source: s.source,
      streaming: s.wasStreaming ? 'yes' : 'no',
      voice_channel: s.voiceChannelName ?? '',
    }))

    if (format === 'json') return json({ guildName, scope, rows }, filename)
    if (format === 'csv') return csv(rows, filename)
    return pdf(
      buildPdf(guildName, 'Gaming history', scope, [
        { kind: 'text', text: `${rows.length} sessions.`, muted: true },
        ...rows.flatMap((r): PdfBlock[] => [
          { kind: 'text', text: `${r.member} — ${r.game}`, bold: true },
          { kind: 'text', text: `${r.duration} — ${r.started}`, muted: true, size: 9 },
        ]),
      ]),
      filename,
    )
  }

  const [gamesRes, playersRes] = await Promise.all([
    fetchGames(supabase, guildId, window.since, tz),
    fetchPlayers(supabase, guildId, window.since),
  ])
  if ('error' in gamesRes) return Response.json({ error: gamesRes.error }, { status: 500 })
  if ('error' in playersRes) return Response.json({ error: playersRes.error }, { status: 500 })

  if (dataset === 'games') {
    const rows = gamesRes.games
      .slice()
      .sort((a, b) => b.totalSeconds - a.totalSeconds)
      .map((g: GameStat) => ({
        game: g.gameName,
        total_seconds: g.totalSeconds,
        playtime: formatDuration(g.totalSeconds),
        players: g.uniquePlayers,
        sessions: g.totalSessions,
        avg_session: formatDuration(g.avgSessionSeconds),
        longest_session: formatDuration(g.longestSeconds),
        first_seen: g.firstSeenAt ?? '',
        last_seen: g.lastSeenAt ?? '',
      }))

    if (format === 'json') return json({ guildName, scope, rows }, filename)
    if (format === 'csv') return csv(rows, filename)
    return pdf(
      buildPdf(guildName, 'Games', scope, [
        ...rows.flatMap((r): PdfBlock[] => [
          { kind: 'text', text: r.game, bold: true },
          {
            kind: 'text',
            text: `${r.playtime} — ${r.players} players — ${r.sessions} sessions`,
            muted: true,
            size: 9,
          },
        ]),
      ]),
      filename,
    )
  }

  if (dataset === 'leaderboards') {
    const boards = LEADERBOARDS.map((key) => ({
      board: key,
      label: LEADERBOARD_LABELS[key],
      rows: buildLeaderboard(playersRes.players, key, 100).map((r) => ({
        rank: r.rank,
        member: displayName(r.player, anonymise, r.rank),
        value: r.display,
      })),
    }))

    if (format === 'json') return json({ guildName, scope, boards }, filename)
    if (format === 'csv') {
      // One flat table so a spreadsheet can pivot it — a CSV cannot express
      // five nested boards, and splitting into five files would surprise
      // anyone who asked for one download.
      const flat = boards.flatMap((b) =>
        b.rows.map((r) => ({ board: b.label, rank: r.rank, member: r.member, value: r.value })),
      )
      return csv(flat, filename)
    }
    return pdf(
      buildPdf(
        guildName,
        'Gaming leaderboards',
        scope,
        boards.flatMap((b): PdfBlock[] => [
          { kind: 'heading', text: b.label, level: 2 },
          ...b.rows
            .slice(0, 25)
            .map((r): PdfBlock => ({ kind: 'text', text: `${r.rank}. ${r.member} — ${r.value}` })),
          { kind: 'space', height: 8 },
        ]),
      ),
      filename,
    )
  }

  // dataset === 'players'
  const ranked = playersRes.players.slice().sort((a, b) => b.totalSeconds - a.totalSeconds)
  const rows = ranked.map((p: PlayerStat, i) => ({
    rank: i + 1,
    member: displayName(p, anonymise, i + 1),
    total_seconds: p.totalSeconds,
    playtime: formatDuration(p.totalSeconds),
    sessions: p.totalSessions,
    games: p.uniqueGames,
    avg_session: formatDuration(p.avgSessionSeconds),
    longest_session: formatDuration(p.longestSeconds),
    favourite_game: anonymise ? '' : (p.favouriteGame ?? ''),
    first_session: p.firstSessionAt ?? '',
    last_session: p.lastSessionAt ?? '',
  }))

  if (format === 'json') return json({ guildName, scope, rows }, filename)
  if (format === 'csv') return csv(rows, filename)
  return pdf(
    buildPdf(guildName, 'Players', scope, [
      ...rows.flatMap((r): PdfBlock[] => [
        { kind: 'text', text: `${r.rank}. ${r.member}`, bold: true },
        {
          kind: 'text',
          text: `${r.playtime} — ${r.sessions} sessions — ${r.games} games`,
          muted: true,
          size: 9,
        },
      ]),
    ]),
    filename,
  )
}

// ── Serialisation ────────────────────────────────────────────────────────

function buildPdf(
  guildName: string,
  heading: string,
  scope: string,
  blocks: PdfBlock[],
): PdfDocument {
  return {
    title: `${guildName} — Gaming ${heading}`,
    subtitle: `${scope} · Exported ${new Date().toLocaleString()} · Generated by Pulsify`,
    footer: `${guildName} — Gaming ${heading}`,
    blocks: blocks.length > 0 ? blocks : [{ kind: 'text', text: 'Nothing to export.', muted: true }],
  }
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ].join('\n')
}

function exportFilename(guildName: string, dataset: string, format: string): string {
  const slug =
    guildName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'server'
  return `gaming-${dataset}-${slug}-${new Date().toISOString().slice(0, 10)}.${format}`
}

function download(body: string | Buffer, contentType: string, filename: string): Response {
  return new Response(body as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      // An export is a snapshot of live activity; never let it be cached.
      'Cache-Control': 'no-store',
    },
  })
}

const json = (payload: unknown, filename: string) =>
  download(
    JSON.stringify({ exportedAt: new Date().toISOString(), ...(payload as object) }, null, 2),
    'application/json; charset=utf-8',
    filename,
  )

// A BOM so Excel opens the file as UTF-8 rather than guessing a codepage —
// without it every em dash and accented name comes out mangled.
const csv = (rows: Record<string, unknown>[], filename: string) =>
  download(`﻿${toCsv(rows)}`, 'text/csv; charset=utf-8', filename)

const pdf = (doc: PdfDocument, filename: string) =>
  download(renderPdf(doc), 'application/pdf', filename)
