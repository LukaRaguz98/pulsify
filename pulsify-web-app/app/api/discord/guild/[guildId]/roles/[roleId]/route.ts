import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import { fetchGuildRoles, modifyGuildRole, deleteGuildRole, type RoleMutation } from '@/lib/discord'
import { sanitizeMutation } from '../route'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string; roleId: string }> },
) {
  const { guildId, roleId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as RoleMutation & { reason?: string }
  const mutation = sanitizeMutation(body)
  const result = await modifyGuildRole(guildId, roleId, mutation, body.reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  await recordNotification({
    guildId,
    type: 'role_updated',
    title: `${auth.moderator.username ?? 'A moderator'} updated role @${result.role.name}`,
    body: body.reason ?? null,
    link: `/dashboard/${guildId}/roles`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: result.role.id,
    targetName: result.role.name,
  })
  return NextResponse.json(result.role)
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ guildId: string; roleId: string }> },
) {
  const { guildId, roleId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const reason = url.searchParams.get('reason') ?? undefined

  // Snapshot the role name before deletion so the notification can reference
  // it; once the role is gone Discord stops returning it.
  const before = await fetchGuildRoles(guildId)
  const targetName = before.find((r) => r.id === roleId)?.name ?? null

  const result = await deleteGuildRole(guildId, roleId, reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  await recordNotification({
    guildId,
    type: 'role_deleted',
    title: `${auth.moderator.username ?? 'A moderator'} deleted role @${targetName ?? 'unknown'}`,
    body: reason ?? null,
    link: `/dashboard/${guildId}/roles`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: roleId,
    targetName,
  })
  return NextResponse.json({ ok: true })
}
