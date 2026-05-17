import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import {
  fetchChannel,
  modifyChannel,
  deleteChannel,
  type ChannelMutation,
} from '@/lib/discord'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string; channelId: string }> },
) {
  const { guildId, channelId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const channel = await fetchChannel(channelId)
  if (!channel) return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
  return NextResponse.json(channel)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string; channelId: string }> },
) {
  const { guildId, channelId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as ChannelMutation & { reason?: string }

  // We need the current channel type to know how to sanitize the name.
  // Fetching adds one round-trip per edit but is the only reliable way:
  // text channels must be lowercase-with-dashes, voice/categories don't.
  const current = await fetchChannel(channelId)
  if (!current) return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })

  const result = await modifyChannel(channelId, body, current.type, body.reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  await recordNotification({
    guildId,
    type: 'channel_updated',
    title: `${auth.moderator.username ?? 'A moderator'} updated #${result.channel.name}`,
    body: body.reason ?? null,
    link: `/dashboard/${guildId}/channels`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: result.channel.id,
    targetName: result.channel.name,
  })
  return NextResponse.json(result.channel)
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ guildId: string; channelId: string }> },
) {
  const { guildId, channelId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const reason = url.searchParams.get('reason') ?? undefined
  // Capture the name before deletion so the notification can reference it.
  const existing = await fetchChannel(channelId)
  const result = await deleteChannel(channelId, reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  await recordNotification({
    guildId,
    type: 'channel_deleted',
    title: `${auth.moderator.username ?? 'A moderator'} deleted #${existing?.name ?? 'a channel'}`,
    body: reason ?? null,
    link: `/dashboard/${guildId}/channels`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: channelId,
    targetName: existing?.name ?? null,
  })
  return NextResponse.json({ ok: true })
}
