import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { authorizeWorkspaceMember } from '@/lib/workspace-auth'
import { categoryForAction, type ActivityCategory } from '@/lib/workspace'
import { enrichWorkspaceServers, getWorkspaceServers } from '@/lib/workspace-data'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50

export type WorkspaceFeedItem = {
  id: string
  ts: string
  category: ActivityCategory
  summary: string
  actor: string | null
  guildName: string | null
  read: boolean
}

/**
 * GET /api/workspace/[workspaceId]/feed
 *
 * Paginated activity / notification feed for the workspace. Merges three
 * sources sorted by created_at desc:
 *  - workspace_activity (notes / tasks / incidents / member events …)
 *  - moderation_logs across the workspace's guilds
 *  - per-guild notifications limited to tickets/bot categories
 *
 * Query params:
 *  - limit: 1-50 (default 25)
 *  - before: ISO timestamp — items strictly older than this
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const auth = await authorizeWorkspaceMember(workspaceId, 'viewActivity')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT)))
  const before = url.searchParams.get('before')

  const supabase = await createClient()
  const servers = await getWorkspaceServers(workspaceId)
  const guildIds = servers.map((s) => s.guild_id)

  // Server names — used to attach a guild label to moderation/notification
  // rows. We over-fetch a little (4x limit) from each source so the merged +
  // sliced result still hands back `limit` items even when one source
  // dominates the window.
  const enriched = guildIds.length > 0 ? await enrichWorkspaceServers(servers) : []
  const serverNames: Record<string, string> = {}
  for (const s of enriched) serverNames[s.guild_id] = s.name

  const fetchLimit = limit * 4

  let activityQuery = supabase
    .from('workspace_activity')
    .select('id, action, category, summary, actor_name, guild_id, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(fetchLimit)
  if (before) activityQuery = activityQuery.lt('created_at', before)

  let modQuery = guildIds.length > 0
    ? supabase
        .from('moderation_logs')
        .select('id, guild_id, action, target_user_id, target_username, moderator_username, created_at')
        .in('guild_id', guildIds)
        .order('created_at', { ascending: false })
        .limit(fetchLimit)
    : null
  if (modQuery && before) modQuery = modQuery.lt('created_at', before)

  let notifQuery = guildIds.length > 0
    ? supabase
        .from('notifications')
        .select('id, guild_id, category, title, actor_name, created_at')
        .in('guild_id', guildIds)
        .in('category', ['tickets', 'bot'])
        .order('created_at', { ascending: false })
        .limit(fetchLimit)
    : null
  if (notifQuery && before) notifQuery = notifQuery.lt('created_at', before)

  const [activityRes, modRes, notifRes] = await Promise.all([
    activityQuery,
    modQuery ?? Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
    notifQuery ?? Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
  ])

  const items: Omit<WorkspaceFeedItem, 'read'>[] = []
  for (const a of (activityRes.data ?? []) as Record<string, string>[]) {
    items.push({
      id: a.id,
      ts: a.created_at,
      category: ((a.category as unknown) as ActivityCategory) ?? categoryForAction(a.action),
      summary: a.summary ?? a.action,
      actor: a.actor_name ?? null,
      guildName: a.guild_id ? serverNames[a.guild_id] ?? null : null,
    })
  }
  for (const m of (modRes.data ?? []) as Record<string, string>[]) {
    items.push({
      id: `mod-${m.id}`,
      ts: m.created_at,
      category: 'moderation',
      summary: `${String(m.action).replace(/_/g, ' ')} — ${m.target_username ?? m.target_user_id ?? 'a user'}`,
      actor: m.moderator_username ?? null,
      guildName: serverNames[m.guild_id] ?? null,
    })
  }
  for (const nrow of (notifRes.data ?? []) as Record<string, string>[]) {
    items.push({
      id: `notif-${nrow.id}`,
      ts: nrow.created_at,
      category: nrow.category === 'tickets' ? 'tickets' : 'warnings',
      summary: nrow.title,
      actor: nrow.actor_name ?? null,
      guildName: serverNames[nrow.guild_id] ?? null,
    })
  }

  items.sort((a, b) => +new Date(b.ts) - +new Date(a.ts))
  // Each source over-fetches independently, so the merged window can stretch
  // past the requested limit — slice it down before returning to keep the
  // payload predictable.
  const sliced = items.slice(0, limit)

  // Join in the caller's read state. We only fetch reads for the keys we're
  // returning — the table can grow large, but the active window stays small.
  let readSet = new Set<string>()
  if (sliced.length > 0) {
    const { data: reads } = await supabase
      .from('workspace_notification_reads')
      .select('item_key')
      .eq('workspace_id', workspaceId)
      .eq('user_id', auth.actor.userId)
      .in('item_key', sliced.map((i) => i.id))
    readSet = new Set((reads ?? []).map((r) => r.item_key as string))
  }

  const withRead: WorkspaceFeedItem[] = sliced.map((i) => ({ ...i, read: readSet.has(i.id) }))

  // For the bell badge: count unread across a wider recent window so the
  // badge is meaningful even when the caller asked for a small `limit`. Cheap
  // — bounded count, no payload.
  const RECENT_DAYS = 30
  const recentCutoff = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString()
  const [actCount, modCount, notifCount, readCount] = await Promise.all([
    supabase.from('workspace_activity').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).gte('created_at', recentCutoff),
    guildIds.length > 0
      ? supabase.from('moderation_logs').select('id', { count: 'exact', head: true }).in('guild_id', guildIds).gte('created_at', recentCutoff)
      : Promise.resolve({ count: 0 }),
    guildIds.length > 0
      ? supabase.from('notifications').select('id', { count: 'exact', head: true }).in('guild_id', guildIds).in('category', ['tickets', 'bot']).gte('created_at', recentCutoff)
      : Promise.resolve({ count: 0 }),
    supabase.from('workspace_notification_reads').select('item_key', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('user_id', auth.actor.userId).gte('read_at', recentCutoff),
  ])
  const totalRecent = (actCount.count ?? 0) + (modCount.count ?? 0) + (notifCount.count ?? 0)
  const unread = Math.max(0, totalRecent - (readCount.count ?? 0))

  return NextResponse.json({ items: withRead, unread_count: unread })
}

/**
 * DELETE /api/workspace/[workspaceId]/feed
 *
 * Bulk-delete workspace_activity rows for this workspace — the equivalent of
 * the server dashboard's "Clear all". Items sourced from moderation_logs and
 * notifications belong to their respective guilds and are intentionally left
 * alone.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const auth = await authorizeWorkspaceMember(workspaceId, 'viewActivity')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()
  const { error } = await supabase.from('workspace_activity').delete().eq('workspace_id', workspaceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
