import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'

/**
 * POST /api/guilds/[guildId]/notifications/read
 *
 * Body: { ids?: string[], all?: boolean }
 *  - `ids`: mark these specific notification IDs as read
 *  - `all`: mark every notification in this guild as read for the current user
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { ids?: string[]; all?: boolean }
  const supabase = await createClient()

  let ids: string[] = []
  if (body.all) {
    const { data, error } = await supabase
      .from('notifications')
      .select('id')
      .eq('guild_id', guildId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    ids = (data ?? []).map((r) => r.id as string)
  } else if (Array.isArray(body.ids) && body.ids.length > 0) {
    // Filter on guild_id to prevent marking notifications from other guilds.
    const { data, error } = await supabase
      .from('notifications')
      .select('id')
      .eq('guild_id', guildId)
      .in('id', body.ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    ids = (data ?? []).map((r) => r.id as string)
  } else {
    return NextResponse.json({ error: 'Provide ids[] or all=true.' }, { status: 400 })
  }

  if (ids.length === 0) return NextResponse.json({ ok: true, count: 0 })

  const rows = ids.map((id) => ({
    notification_id: id,
    user_id: auth.moderator.userId,
  }))
  // upsert ignores existing rows so re-marking is a no-op.
  const { error } = await supabase
    .from('notification_reads')
    .upsert(rows, { onConflict: 'notification_id,user_id', ignoreDuplicates: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, count: ids.length })
}

/**
 * DELETE /api/guilds/[guildId]/notifications/read?ids=a,b,c
 * Mark notifications as unread (delete read rows).
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const ids = (url.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) return NextResponse.json({ ok: true, count: 0 })

  const supabase = await createClient()
  // Scope the unread toggle to this guild's notifications so a user can't
  // un-read someone else's by ID guessing.
  const { data: scoped } = await supabase
    .from('notifications')
    .select('id')
    .eq('guild_id', guildId)
    .in('id', ids)
  const scopedIds = (scoped ?? []).map((r) => r.id as string)
  if (scopedIds.length === 0) return NextResponse.json({ ok: true, count: 0 })

  const { error } = await supabase
    .from('notification_reads')
    .delete()
    .eq('user_id', auth.moderator.userId)
    .in('notification_id', scopedIds)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: scopedIds.length })
}
