import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'

const MAX_LIMIT = 100

/**
 * GET /api/guilds/[guildId]/notifications
 *
 * Returns the most recent notifications for the guild, joined with the
 * current user's read state. Supports filtering by category(s) and
 * unread-only.
 *
 * Query params:
 *  - limit: 1-100 (default 50)
 *  - before: ISO timestamp — pagination cursor (older than)
 *  - category: comma-separated list of categories to include
 *  - unread: '1' to only return unread items for the current user
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit') ?? 50)))
  const before = url.searchParams.get('before')
  const categoryParam = url.searchParams.get('category')
  const unread = url.searchParams.get('unread') === '1'

  const supabase = await createClient()
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (before) query = query.lt('created_at', before)
  if (categoryParam) {
    const cats = categoryParam.split(',').map((c) => c.trim()).filter(Boolean)
    if (cats.length > 0) query = query.in('category', cats)
  }

  const { data: rows, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const notificationIds = (rows ?? []).map((r) => r.id as string)
  let readSet = new Set<string>()
  if (notificationIds.length > 0) {
    const { data: reads } = await supabase
      .from('notification_reads')
      .select('notification_id')
      .eq('user_id', auth.moderator.userId)
      .in('notification_id', notificationIds)
    readSet = new Set((reads ?? []).map((r) => r.notification_id as string))
  }

  let withRead = (rows ?? []).map((r) => ({ ...r, read: readSet.has(r.id as string) }))
  if (unread) withRead = withRead.filter((r) => !r.read)

  // Single round-trip for the unread badge — the dashboard polls this on
  // mount and uses Realtime increments after that, so an extra count here
  // is cheap.
  const { data: countData } = await supabase
    .rpc('get_notification_unread_count', { p_user_id: auth.moderator.userId, p_guild_id: guildId })

  return NextResponse.json({
    notifications: withRead,
    unread_count: typeof countData === 'number' ? countData : 0,
  })
}

/**
 * DELETE /api/guilds/[guildId]/notifications?older_than_days=30
 *
 * Bulk-delete notifications for this guild. With no params, deletes all.
 * Used by the "Clear all" action in the notifications page.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const olderThanDays = Number(url.searchParams.get('older_than_days') ?? '')
  const supabase = await createClient()

  let query = supabase.from('notifications').delete().eq('guild_id', guildId)
  if (Number.isFinite(olderThanDays) && olderThanDays > 0) {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString()
    query = query.lt('created_at', cutoff)
  }
  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
