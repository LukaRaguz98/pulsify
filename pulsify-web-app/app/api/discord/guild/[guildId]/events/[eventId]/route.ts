import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import { modifyGuildEvent, deleteGuildEvent, type EventMutation } from '@/lib/discord'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string; eventId: string }> },
) {
  const { guildId, eventId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as EventMutation & { reason?: string }
  const result = await modifyGuildEvent(guildId, eventId, body, body.reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  // Discord's status field doubles as cancel/complete signal — use it to pick
  // a more specific notification type.
  const wasCancelled = body.status === 4
  await recordNotification({
    guildId,
    type: wasCancelled ? 'event_deleted' : 'event_updated',
    title: wasCancelled
      ? `${auth.moderator.username ?? 'A moderator'} cancelled "${result.event.name}"`
      : `${auth.moderator.username ?? 'A moderator'} updated "${result.event.name}"`,
    body: body.reason ?? null,
    link: `/dashboard/${guildId}/events`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: result.event.id,
    targetName: result.event.name,
  })
  return NextResponse.json(result.event)
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ guildId: string; eventId: string }> },
) {
  const { guildId, eventId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const reason = url.searchParams.get('reason') ?? undefined
  const result = await deleteGuildEvent(guildId, eventId, reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  await recordNotification({
    guildId,
    type: 'event_deleted',
    title: `${auth.moderator.username ?? 'A moderator'} deleted an event`,
    body: reason ?? null,
    link: `/dashboard/${guildId}/events`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: eventId,
  })
  return NextResponse.json({ ok: true })
}
