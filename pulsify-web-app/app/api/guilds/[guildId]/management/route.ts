import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildMembers, fetchGuildEvents, avatarUrl } from '@/lib/discord'
import { isTimeframe, timeframeWindowDays, type Timeframe } from '@/lib/analytics'
import {
  buildManagement,
  modActionKind,
  type StaffEvent,
  type TicketRecord,
  type StaffDirectoryEntry,
} from '@/lib/management'

const DAY_MS = 86_400_000
const MEMBER_LIMIT = 1000

// ticket_events.type → the support action kind we attribute. Lifecycle events
// that aren't staff *work* (opened, panel_posted, renamed, priority_changed,
// user_added/removed, deleted) are intentionally dropped.
const TICKET_EVENT_KIND: Record<string, StaffEvent['kind']> = {
  claimed: 'ticket_claim',
  assigned: 'ticket_claim',
  closed: 'ticket_close',
  reopened: 'ticket_note',
  note: 'ticket_note',
}

/**
 * GET /api/guilds/[guildId]/management?timeframe=24h|7d|30d|all
 *
 * Aggregates every attributable management action — moderation, support and
 * community — into per-staff performance, rankings, support timing and
 * management insights. Auth mirrors the analytics/insights routes (Supabase
 * session only): this is a frequently-loaded read view, so we avoid the
 * rate-limited `/users/@me/guilds` moderation-auth check.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId } = await params
  const tfParam = new URL(req.url).searchParams.get('timeframe')
  const timeframe: Timeframe = isTimeframe(tfParam) ? tfParam : '7d'

  const now = Date.now()
  // 24h/7d/30d fetch 2× the window (current + previous, for trends); 'all' has
  // no lower bound. The ticket workload window is a single window length.
  const fixedDays = timeframeWindowDays(timeframe)
  const trendSince = fixedDays !== null ? new Date(now - fixedDays * 2 * DAY_MS).toISOString() : null
  const windowSince = fixedDays !== null ? new Date(now - fixedDays * DAY_MS).toISOString() : null

  // Optionally lower-bound a query by a created-at column (skipped for 'all').
  const since = <T extends { gte: (col: string, v: string) => T }>(q: T, col: string, value: string | null): T =>
    value !== null ? q.gte(col, value) : q

  const [
    modRes,
    ticketEventsRes,
    ticketsRes,
    openTicketsRes,
    announcementsRes,
    giveawaysRes,
    supportRolesRes,
    scheduledEvents,
    members,
  ] = await Promise.all([
    since(
      supabase.from('moderation_logs').select('moderator_id, moderator_username, action, created_at').eq('guild_id', guildId),
      'created_at',
      trendSince,
    ),
    since(
      supabase.from('ticket_events').select('ticket_id, type, actor_id, actor_name, created_at').eq('guild_id', guildId),
      'created_at',
      trendSince,
    ),
    since(
      supabase.from('tickets').select('id, status, opened_at, closed_at, closed_by, closed_by_name').eq('guild_id', guildId),
      'opened_at',
      windowSince,
    ),
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .neq('status', 'closed'),
    since(
      supabase.from('announcements').select('author_id, author_name, created_by, status, created_at').eq('guild_id', guildId).eq('status', 'published'),
      'created_at',
      trendSince,
    ),
    since(
      supabase.from('giveaways').select('host_id, host_name, created_by, created_at').eq('guild_id', guildId),
      'created_at',
      trendSince,
    ),
    supabase
      .from('ticket_configs')
      .select('support_role_ids')
      .eq('guild_id', guildId)
      .maybeSingle(),
    fetchGuildEvents(guildId).catch(() => []),
    fetchGuildMembers(guildId, MEMBER_LIMIT).catch(() => []),
  ])

  const firstError = modRes.error ?? ticketEventsRes.error ?? ticketsRes.error
  if (firstError) {
    return NextResponse.json(
      { error: `Management query failed: ${firstError.message}` },
      { status: 500 },
    )
  }

  type ModRow = { moderator_id: string; moderator_username: string | null; action: string; created_at: string }
  type TicketEventRow = { ticket_id: string; type: string; actor_id: string | null; actor_name: string | null; created_at: string }
  type TicketRow = { id: string; status: string; opened_at: string; closed_at: string | null; closed_by: string | null; closed_by_name: string | null }
  type AnnouncementRow = { author_id: string | null; author_name: string | null; created_by: string | null; created_at: string }
  type GiveawayRow = { host_id: string | null; host_name: string | null; created_by: string | null; created_at: string }

  const modRows = (modRes.data ?? []) as ModRow[]
  const ticketEventRows = (ticketEventsRes.data ?? []) as TicketEventRow[]
  const ticketRows = (ticketsRes.data ?? []) as TicketRow[]
  const announcementRows = (announcementsRes.data ?? []) as AnnouncementRow[]
  const giveawayRows = (giveawaysRes.data ?? []) as GiveawayRow[]

  // ── Build the unified event stream ──────────────────────────────────────────
  const events: StaffEvent[] = []

  for (const r of modRows) {
    if (!r.moderator_id) continue
    events.push({ actorId: r.moderator_id, actorName: r.moderator_username, kind: modActionKind(r.action), at: r.created_at })
  }

  // Earliest claim/assign per ticket → first-response attribution.
  const firstResponse = new Map<string, { at: string; actorId: string; actorName: string | null }>()
  for (const r of ticketEventRows) {
    const kind = TICKET_EVENT_KIND[r.type]
    if (!kind || !r.actor_id) continue
    events.push({ actorId: r.actor_id, actorName: r.actor_name, kind, at: r.created_at })
    if (kind === 'ticket_claim') {
      const existing = firstResponse.get(r.ticket_id)
      if (!existing || new Date(r.created_at).getTime() < new Date(existing.at).getTime()) {
        firstResponse.set(r.ticket_id, { at: r.created_at, actorId: r.actor_id, actorName: r.actor_name })
      }
    }
  }

  for (const r of announcementRows) {
    const actorId = r.author_id ?? r.created_by
    if (!actorId) continue
    events.push({ actorId, actorName: r.author_name, kind: 'announcement', at: r.created_at })
  }

  for (const r of giveawayRows) {
    const actorId = r.host_id ?? r.created_by
    if (!actorId) continue
    events.push({ actorId, actorName: r.host_name, kind: 'giveaway', at: r.created_at })
  }

  // Discord scheduled events have no created_at, so they're attributed to the
  // current window as a best-effort "events created" signal for their creator.
  const nowIso = new Date(now).toISOString()
  for (const ev of scheduledEvents) {
    if (!ev.creator?.id) continue
    events.push({ actorId: ev.creator.id, actorName: ev.creator.username, kind: 'event', at: nowIso })
  }

  // ── Ticket records (timing + workload) ──────────────────────────────────────
  const tickets: TicketRecord[] = ticketRows.map((r) => {
    const fr = firstResponse.get(r.id) ?? null
    return {
      id: r.id,
      openedAt: r.opened_at,
      firstResponseAt: fr?.at ?? null,
      responderId: fr?.actorId ?? null,
      responderName: fr?.actorName ?? null,
      resolved: r.status === 'closed',
      closedAt: r.closed_at,
      closedById: r.closed_by,
      closedByName: r.closed_by_name,
    }
  })

  // ── Staff directory (Discord enrichment + known-staff seed) ─────────────────
  const supportRoleIds = new Set<string>(
    ((supportRolesRes.data?.support_role_ids ?? []) as string[]).map(String),
  )
  const directory: StaffDirectoryEntry[] = []
  for (const m of members) {
    if (m.user.bot) continue
    const isSupportRole = m.roles.some((rid) => supportRoleIds.has(rid))
    directory.push({
      id: m.user.id,
      name: m.nick ?? m.user.global_name ?? m.user.username,
      avatar: m.user.avatar ? avatarUrl(m.user.id, m.user.avatar, '0', 64) : null,
      isSupportRole,
    })
  }

  const data = buildManagement({
    timeframe,
    now,
    events,
    tickets,
    directory,
    openTickets: openTicketsRes.count ?? 0,
  })

  return NextResponse.json(data)
}
