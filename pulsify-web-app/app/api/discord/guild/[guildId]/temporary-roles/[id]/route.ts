import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { createClient } from '@/lib/supabase-server'
import { recordNotification } from '@/lib/notifications-server'
import { recordTempRoleEvent } from '@/lib/temporary-roles-server'
import { removeMemberRoleDiscord } from '@/lib/discord'
import { validateExpiry, EXPIRING_SOON_MS } from '@/lib/temporary-roles'

// PATCH — extend or shorten an active assignment by setting a new expiry.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string; id: string }> },
) {
  const { guildId, id } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { expiresAt?: string }
  if (!body.expiresAt) return NextResponse.json({ error: 'A new expiration is required.' }, { status: 400 })
  const next = new Date(body.expiresAt)
  const expiryError = validateExpiry(next)
  if (expiryError) return NextResponse.json({ error: expiryError }, { status: 400 })

  const supabase = await createClient()
  const { data: row } = await supabase
    .from('temporary_roles')
    .select('*')
    .eq('id', id)
    .eq('guild_id', guildId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  if (row.status !== 'active') {
    return NextResponse.json({ error: 'Only active assignments can be changed.' }, { status: 400 })
  }

  const oldExpiry = Date.parse(row.expires_at)
  const action = next.getTime() >= oldExpiry ? 'extended' : 'shortened'
  // Clear the "expiring soon" warning flag when the new expiry moves back out of
  // the warning window, so the bot can warn again later.
  const stillSoon = next.getTime() - Date.now() <= EXPIRING_SOON_MS
  const { data: updated, error } = await supabase
    .from('temporary_roles')
    .update({
      expires_at: next.toISOString(),
      expiry_warned_at: stillSoon ? row.expiry_warned_at : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordTempRoleEvent(supabase, {
    guildId,
    temporaryRoleId: id,
    userId: row.user_id,
    userName: row.user_name,
    roleId: row.role_id,
    roleName: row.role_name,
    action,
    source: row.source,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    detail: { from: row.expires_at, to: next.toISOString() },
  })

  if (action === 'extended' && row.notify_admin) {
    await recordNotification({
      guildId,
      type: 'temp_role_extended',
      title: `${auth.moderator.username ?? 'A moderator'} extended @${row.role_name ?? 'a role'}`,
      body: `Now expires ${next.toLocaleString()}`,
      link: `/dashboard/${guildId}/roles?tab=temporary`,
      actorId: auth.moderator.userId,
      actorName: auth.moderator.username,
      actorUsername: auth.moderator.handle,
      targetId: row.user_id,
      targetName: row.user_name,
      metadata: { role_id: row.role_id, temporary_role_id: id },
    })
  }

  return NextResponse.json(updated)
}

// DELETE — remove the role from the member now and mark the assignment removed.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ guildId: string; id: string }> },
) {
  const { guildId, id } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()
  const { data: row } = await supabase
    .from('temporary_roles')
    .select('*')
    .eq('id', id)
    .eq('guild_id', guildId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })

  // Best-effort Discord removal. A "role no longer exists / member left" case
  // still lets us mark the row removed so the dashboard stays consistent.
  if (row.status === 'active') {
    await removeMemberRoleDiscord(guildId, row.user_id, row.role_id, 'Temporary role removed via Pulsify')
  }

  const { error } = await supabase
    .from('temporary_roles')
    .update({
      status: 'removed',
      ended_at: new Date().toISOString(),
      ended_by: auth.moderator.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordTempRoleEvent(supabase, {
    guildId,
    temporaryRoleId: id,
    userId: row.user_id,
    userName: row.user_name,
    roleId: row.role_id,
    roleName: row.role_name,
    action: 'removed',
    source: row.source,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    detail: { manual: true },
  })

  return NextResponse.json({ ok: true })
}
