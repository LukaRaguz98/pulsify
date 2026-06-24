import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { createClient } from '@/lib/supabase-server'
import { recordTempRoleEvent } from '@/lib/temporary-roles-server'
import { removeMemberRoleDiscord } from '@/lib/discord'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { ids?: string[] }
  const ids = (body.ids ?? []).filter((x) => typeof x === 'string').slice(0, 200)
  if (ids.length === 0) return NextResponse.json({ error: 'No assignments selected.' }, { status: 400 })

  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('temporary_roles')
    .select('*')
    .eq('guild_id', guildId)
    .in('id', ids)
  if (!rows || rows.length === 0) return NextResponse.json({ removed: 0, failed: 0 })

  let removed = 0
  const nowIso = new Date().toISOString()
  for (const row of rows) {
    if (row.status === 'active') {
      await removeMemberRoleDiscord(guildId, row.user_id, row.role_id, 'Temporary role bulk-removed via Pulsify')
    }
    const { error } = await supabase
      .from('temporary_roles')
      .update({ status: 'removed', ended_at: nowIso, ended_by: auth.moderator.userId, updated_at: nowIso })
      .eq('id', row.id)
    if (error) continue
    removed++
    await recordTempRoleEvent(supabase, {
      guildId,
      temporaryRoleId: row.id,
      userId: row.user_id,
      userName: row.user_name,
      roleId: row.role_id,
      roleName: row.role_name,
      action: 'removed',
      source: row.source,
      actorId: auth.moderator.userId,
      actorName: auth.moderator.username,
      detail: { bulk: true },
    })
  }

  return NextResponse.json({ removed, failed: rows.length - removed })
}
