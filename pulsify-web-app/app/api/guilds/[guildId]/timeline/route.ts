import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import {
  parseTimelineFilters,
  retentionWindow,
  effectiveSince,
  fetchTimelinePage,
} from '@/lib/timeline-query'

const DEFAULT_LIMIT = 40
const MAX_LIMIT = 100

/**
 * GET /api/guilds/[guildId]/timeline
 *
 * One page of the Server Timeline, newest first.
 *
 * Filters (all optional): `category`, `actor` (Discord id), `member` (Discord
 * id — matches the target or anyone in `affected_users`), `module`, `type`
 * (event type), `from` / `to` (YYYY-MM-DD), `q` (keyword). Pagination is a
 * keyset: pass the previous response's `nextCursor` as `cursor`.
 *
 * The window is bounded by the guild plan's `logRetentionDays` — the response
 * reports `retentionDays` and `windowStart` so the UI can tell the admin when
 * they've hit the end of their plan's history rather than the end of the data.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params

  // Management surface: the timeline exposes moderation, member and config
  // history, so it's Manage Server / Administrator only.
  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const filters = parseTimelineFilters(url)
  const cursor = url.searchParams.get('cursor')
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT),
  )

  const { retentionDays, since } = await retentionWindow(guildId)
  const windowStart = effectiveSince(since, filters.from)

  const supabase = await createClient()
  const result = await fetchTimelinePage(supabase, guildId, filters, {
    since: windowStart,
    cursor: cursor && !Number.isNaN(Date.parse(cursor)) ? cursor : null,
    limit,
  })

  if ('error' in result) {
    return NextResponse.json(
      { error: `History query failed: ${result.error}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ...result.page,
    retentionDays: Number.isFinite(retentionDays) ? retentionDays : null,
    windowStart: since,
  })
}
