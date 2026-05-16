import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import {
  setChannelPermissionOverwrite,
  deleteChannelPermissionOverwrite,
} from '@/lib/discord'

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ guildId: string; channelId: string; overwriteId: string }> },
) {
  const { guildId, channelId, overwriteId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    type?: 0 | 1
    allow?: string
    deny?: string
    reason?: string
  }
  if (body.type !== 0 && body.type !== 1) {
    return NextResponse.json({ error: 'type must be 0 (role) or 1 (member).' }, { status: 400 })
  }
  if (typeof body.allow !== 'string' || typeof body.deny !== 'string') {
    return NextResponse.json({ error: 'allow and deny must be bitfield strings.' }, { status: 400 })
  }

  const result = await setChannelPermissionOverwrite(
    channelId,
    overwriteId,
    { type: body.type, allow: body.allow, deny: body.deny },
    body.reason,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ guildId: string; channelId: string; overwriteId: string }> },
) {
  const { guildId, channelId, overwriteId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const reason = url.searchParams.get('reason') ?? undefined
  const result = await deleteChannelPermissionOverwrite(channelId, overwriteId, reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
