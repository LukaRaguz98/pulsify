import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import {
  fetchGuildChannels,
  createGuildChannel,
  reorderGuildChannels,
  type ChannelCreate,
  type CreatableChannelType,
} from '@/lib/discord'

const CREATABLE_TYPES: ReadonlySet<number> = new Set([0, 2, 4, 5, 13, 15, 16])

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  // GET is intentionally relaxed — the events editor, role editor, etc. all
  // need to list channels and only require the user to be signed in.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId } = await params
  const channels = await fetchGuildChannels(guildId)
  return NextResponse.json(channels)
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Partial<ChannelCreate> & { reason?: string }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Channel name is required.' }, { status: 400 })
  }
  if (typeof body.type !== 'number' || !CREATABLE_TYPES.has(body.type)) {
    return NextResponse.json({ error: 'Unsupported channel type.' }, { status: 400 })
  }

  const result = await createGuildChannel(
    guildId,
    {
      name: body.name,
      type: body.type as CreatableChannelType,
      parent_id: body.parent_id ?? undefined,
      topic: body.topic ?? undefined,
      nsfw: body.nsfw,
      rate_limit_per_user: body.rate_limit_per_user,
      bitrate: body.bitrate,
      user_limit: body.user_limit,
      position: body.position,
    },
    body.reason,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  await recordNotification({
    guildId,
    type: 'channel_created',
    title: `${auth.moderator.username ?? 'A moderator'} created #${result.channel.name}`,
    body: body.reason ?? null,
    link: `/dashboard/${guildId}/channels`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: result.channel.id,
    targetName: result.channel.name,
    metadata: { channel_type: result.channel.type, parent_id: result.channel.parent_id },
  })
  return NextResponse.json(result.channel)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    updates?: { id: string; position?: number; parent_id?: string | null }[]
    reason?: string
  }
  if (!Array.isArray(body.updates)) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  }
  const result = await reorderGuildChannels(guildId, body.updates, body.reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
