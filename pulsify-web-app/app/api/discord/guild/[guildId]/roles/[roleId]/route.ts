import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import { recordTimelineEvent } from '@/lib/timeline-server'
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

  // Snapshot the role before the edit so the timeline can show what actually
  // changed — a rename and a permission grant are very different events, and
  // "updated role @Staff" alone can't tell them apart weeks later.
  const before = (await fetchGuildRoles(guildId)).find((r) => r.id === roleId) ?? null

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
    timeline: false,
  })

  const renamed = before != null && mutation.name !== undefined && mutation.name !== before.name
  const permissionsChanged =
    before != null && mutation.permissions !== undefined && mutation.permissions !== before.permissions

  await recordTimelineEvent({
    guildId,
    // Rename wins the headline when both changed — it's the change an admin
    // scanning the feed recognises the role by.
    type: renamed ? 'role_renamed' : permissionsChanged ? 'role_permissions_changed' : 'role_updated',
    title: renamed
      ? `Role @${before!.name} was renamed to @${result.role.name}`
      : permissionsChanged
        ? `Permissions changed on @${result.role.name}`
        : `Role @${result.role.name} was updated`,
    description: body.reason ?? null,
    source: 'dashboard',
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: result.role.id,
    targetName: result.role.name,
    previousValue: before ? pickRoleFields(before as unknown as Record<string, unknown>, mutation) : null,
    newValue: mutation as Record<string, unknown>,
    link: `/dashboard/${guildId}/roles`,
  })

  return NextResponse.json(result.role)
}

/** The "before" side of a role diff: only the fields the mutation touched. */
function pickRoleFields(
  role: Record<string, unknown>,
  mutation: RoleMutation,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(mutation)) out[key] = role[key] ?? null
  return out
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
