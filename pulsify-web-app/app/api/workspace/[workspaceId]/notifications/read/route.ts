import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { authorizeWorkspaceMember } from '@/lib/workspace-auth'

/**
 * Mark workspace notification items as read for the current user.
 *
 * POST /api/workspace/[workspaceId]/notifications/read
 *   Body: { ids?: string[], all?: boolean }
 *     - `ids`: synthesised feed item keys (bare uuid for workspace_activity,
 *        `mod-<uuid>` for moderation_logs, `notif-<uuid>` for notifications)
 *     - `all`: mark every visible item in the last 30 days as read for the
 *        current user. Mirrors the server dashboard's notifications/read shape.
 *
 * DELETE /api/workspace/[workspaceId]/notifications/read?ids=a,b,c
 *   Mark items as unread (delete the read rows).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const auth = await authorizeWorkspaceMember(workspaceId, 'viewActivity')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { ids?: string[]; all?: boolean }
  const supabase = await createClient()

  let keys: string[] = []
  if (body.all) {
    // "Mark all" inserts a read row for every item currently surfaced by the
    // feed — same approach the server dashboard uses against its notifications
    // table. We bound it to the last 30 days (the same window the bell counts)
    // so the upsert payload stays small.
    const recentCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()

    const { data: serverRows } = await supabase
      .from('workspace_servers')
      .select('guild_id')
      .eq('workspace_id', workspaceId)
    const guildIds = (serverRows ?? []).map((r: { guild_id: string }) => r.guild_id)

    const [activityRes, modRes, notifRes] = await Promise.all([
      supabase
        .from('workspace_activity')
        .select('id')
        .eq('workspace_id', workspaceId)
        .gte('created_at', recentCutoff),
      guildIds.length > 0
        ? supabase
            .from('moderation_logs')
            .select('id')
            .in('guild_id', guildIds)
            .gte('created_at', recentCutoff)
        : Promise.resolve({ data: [] as { id: string }[] }),
      guildIds.length > 0
        ? supabase
            .from('notifications')
            .select('id')
            .in('guild_id', guildIds)
            .in('category', ['tickets', 'bot'])
            .gte('created_at', recentCutoff)
        : Promise.resolve({ data: [] as { id: string }[] }),
    ])

    for (const r of (activityRes.data ?? []) as { id: string }[]) keys.push(r.id)
    for (const r of (modRes.data ?? []) as { id: string }[]) keys.push(`mod-${r.id}`)
    for (const r of (notifRes.data ?? []) as { id: string }[]) keys.push(`notif-${r.id}`)
  } else if (Array.isArray(body.ids) && body.ids.length > 0) {
    keys = body.ids
  } else {
    return NextResponse.json({ error: 'Provide ids[] or all=true.' }, { status: 400 })
  }

  if (keys.length === 0) return NextResponse.json({ ok: true, count: 0 })

  const rows = keys.map((item_key) => ({
    workspace_id: workspaceId,
    user_id: auth.actor.userId,
    item_key,
  }))

  const { error } = await supabase
    .from('workspace_notification_reads')
    .upsert(rows, { onConflict: 'workspace_id,user_id,item_key', ignoreDuplicates: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, count: keys.length })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const auth = await authorizeWorkspaceMember(workspaceId, 'viewActivity')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const ids = (url.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) return NextResponse.json({ ok: true, count: 0 })

  const supabase = await createClient()
  const { error } = await supabase
    .from('workspace_notification_reads')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', auth.actor.userId)
    .in('item_key', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, count: ids.length })
}
