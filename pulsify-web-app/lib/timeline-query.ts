import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getGuildLimits } from '@/lib/billing-server'
import {
  TIMELINE_CATEGORIES,
  toTimelineEvent,
  type TimelineEvent,
  type TimelineEventRow,
} from '@/lib/timeline'

/**
 * Shared query layer for the Server Timeline (PULSIFY-63).
 *
 * The feed, the stats strip and the exports all read the same rows through the
 * same filters and the same retention window — keeping that in one place is
 * what stops "export all" from quietly returning more history than the page
 * showed.
 */

const DAY_MS = 86_400_000

/** Discord snowflakes. Validated before interpolation into a PostgREST filter. */
const SNOWFLAKE = /^\d{5,25}$/
/** Module / event-type slugs. Same reason. */
const SLUG = /^[a-z0-9_-]{1,64}$/i

export type ParsedTimelineFilters = {
  category: string | null
  actorId: string | null
  memberId: string | null
  module: string | null
  eventType: string | null
  /** Inclusive lower bound as an ISO timestamp, or null. */
  from: string | null
  /** Exclusive upper bound as an ISO timestamp, or null. */
  to: string | null
  query: string | null
}

/**
 * Read filters off a request's query string, dropping anything malformed
 * rather than erroring — a stale bookmark with a removed category should show
 * the unfiltered feed, not a 400.
 */
export function parseTimelineFilters(url: URL): ParsedTimelineFilters {
  const get = (key: string) => {
    const raw = url.searchParams.get(key)
    const trimmed = raw?.trim()
    return trimmed && trimmed.length > 0 ? trimmed : null
  }

  const category = get('category')
  const actorId = get('actor')
  const memberId = get('member')
  const moduleKey = get('module')
  const eventType = get('type')
  const from = parseDate(get('from'), 'start')
  const to = parseDate(get('to'), 'end')

  return {
    category: category && (TIMELINE_CATEGORIES as readonly string[]).includes(category) ? category : null,
    actorId: actorId && SNOWFLAKE.test(actorId) ? actorId : null,
    memberId: memberId && SNOWFLAKE.test(memberId) ? memberId : null,
    module: moduleKey && SLUG.test(moduleKey) ? moduleKey : null,
    eventType: eventType && SLUG.test(eventType) ? eventType : null,
    from,
    to,
    query: get('q')?.slice(0, 120) ?? null,
  }
}

/**
 * A `YYYY-MM-DD` date filter into an ISO instant. `end` pushes to the start of
 * the following day so the range reads inclusively in the UI ("to 18 July"
 * includes everything that happened on the 18th).
 */
function parseDate(value: string | null, edge: 'start' | 'end'): string | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  if (edge === 'end') date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

/**
 * The oldest instant a guild may read history from, per its plan's
 * `logRetentionDays`.
 *
 * PULSIFY-62's audit listed this limit as display-only ("logs stay in the DB,
 * the number is pricing-page copy"). The timeline is where it becomes real:
 * rows are never deleted, but a plan's window is what the feed, the statistics
 * and the exports all read through — so a downgrade hides history rather than
 * destroying it, and an upgrade brings it straight back.
 */
export async function retentionWindow(guildId: string): Promise<{
  retentionDays: number
  since: string | null
}> {
  const limits = await getGuildLimits(guildId)
  const days = limits.logRetentionDays
  if (!Number.isFinite(days) || days <= 0) return { retentionDays: days, since: null }
  return {
    retentionDays: days,
    since: new Date(Date.now() - days * DAY_MS).toISOString(),
  }
}

/** The effective lower bound: the later of the plan window and the user's filter. */
export function effectiveSince(
  retentionSince: string | null,
  filterFrom: string | null,
): string | null {
  if (!retentionSince) return filterFrom
  if (!filterFrom) return retentionSince
  return filterFrom > retentionSince ? filterFrom : retentionSince
}

type QueryBuilder = ReturnType<ReturnType<SupabaseClient['from']>['select']>

/**
 * Apply the parsed filters to a `timeline_events` select.
 *
 * `since` is passed separately because it's the AND of the plan window and the
 * caller's own `from` — see effectiveSince.
 */
export function applyTimelineFilters(
  query: QueryBuilder,
  filters: ParsedTimelineFilters,
  since: string | null,
): QueryBuilder {
  let q = query
  if (since) q = q.gte('created_at', since)
  if (filters.to) q = q.lt('created_at', filters.to)
  if (filters.category) q = q.eq('category', filters.category)
  if (filters.actorId) q = q.eq('actor_id', filters.actorId)
  if (filters.module) q = q.eq('module', filters.module)
  if (filters.eventType) q = q.eq('event_type', filters.eventType)
  if (filters.memberId) {
    // "Everything about this member": events targeting them, plus events that
    // merely touched them (giveaway winners, bulk grants). Safe to interpolate
    // — the id is snowflake-validated above, and the JSON fragment contains no
    // comma, so PostgREST's `or` parser can't mis-split it.
    q = q.or(`target_id.eq.${filters.memberId},affected_users.cs.[{"id":"${filters.memberId}"}]`)
  }
  if (filters.query) {
    // `search_text` is a generated, already-lowercased concatenation of the
    // title, description, actor, target, event type and module — one column to
    // match instead of an OR across six. We lowercase the needle and use LIKE
    // rather than ILIKE so the comparison stays index-eligible.
    q = q.like('search_text', `%${escapeLike(filters.query.toLowerCase())}%`)
  }
  return q
}

/** Neutralise LIKE wildcards so a literal % or _ in a search doesn't match everything. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export type TimelinePage = {
  events: TimelineEvent[]
  /** `created_at` of the last row — pass back as `cursor` for the next page. */
  nextCursor: string | null
  hasMore: boolean
}

/**
 * One page of the feed, newest first.
 *
 * Pagination is a keyset on `created_at` rather than an offset: the timeline is
 * append-only at the head, so an offset would skip or repeat rows whenever a
 * new event lands mid-scroll.
 */
export async function fetchTimelinePage(
  supabase: SupabaseClient,
  guildId: string,
  filters: ParsedTimelineFilters,
  opts: { since: string | null; cursor: string | null; limit: number },
): Promise<{ page: TimelinePage } | { error: string }> {
  let query = supabase
    .from('timeline_events')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    // Fetch one extra row to learn whether another page exists without a count.
    .limit(opts.limit + 1)

  query = applyTimelineFilters(query, filters, opts.since)
  if (opts.cursor) query = query.lt('created_at', opts.cursor)

  const { data, error } = await query
  if (error) return { error: error.message }

  const rows = (data ?? []) as TimelineEventRow[]
  const hasMore = rows.length > opts.limit
  const pageRows = hasMore ? rows.slice(0, opts.limit) : rows
  const events = pageRows.map(toTimelineEvent)

  return {
    page: {
      events,
      nextCursor: hasMore ? pageRows[pageRows.length - 1].created_at : null,
      hasMore,
    },
  }
}

/**
 * Every row matching the filters, for an export. Capped — an export is a file
 * a human reads, not a database dump, and an unbounded read would happily try
 * to serialise a year of a busy server into one response.
 */
export const EXPORT_ROW_CAP = 10_000

export async function fetchTimelineForExport(
  supabase: SupabaseClient,
  guildId: string,
  filters: ParsedTimelineFilters,
  opts: { since: string | null; ids?: string[] },
): Promise<{ events: TimelineEvent[]; truncated: boolean } | { error: string }> {
  // "Selected events" — an explicit id list wins over the filters entirely, so
  // ticking three rows exports exactly those three.
  if (opts.ids && opts.ids.length > 0) {
    const { data, error } = await supabase
      .from('timeline_events')
      .select('*')
      .eq('guild_id', guildId)
      .in('id', opts.ids.slice(0, EXPORT_ROW_CAP))
      .order('created_at', { ascending: false })
    if (error) return { error: error.message }
    return { events: ((data ?? []) as TimelineEventRow[]).map(toTimelineEvent), truncated: false }
  }

  let query = supabase
    .from('timeline_events')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(EXPORT_ROW_CAP + 1)

  query = applyTimelineFilters(query, filters, opts.since)

  const { data, error } = await query
  if (error) return { error: error.message }

  const rows = (data ?? []) as TimelineEventRow[]
  const truncated = rows.length > EXPORT_ROW_CAP
  return {
    events: (truncated ? rows.slice(0, EXPORT_ROW_CAP) : rows).map(toTimelineEvent),
    truncated,
  }
}
