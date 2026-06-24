import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { modifyGuildSticker, deleteGuildSticker, checkBotExpressionPerms } from '@/lib/discord'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string; stickerId: string }> },
) {
  const { guildId, stickerId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const perms = await checkBotExpressionPerms(guildId)
  if (perms && !perms.manage) {
    return NextResponse.json(
      { error: 'The bot needs the "Manage Expressions" permission to edit stickers.' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    description?: string
    tags?: string
    reason?: string
  }
  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json({ error: 'A name is required.' }, { status: 400 })
  }
  const result = await modifyGuildSticker(
    guildId,
    stickerId,
    { name: body.name, description: body.description, tags: body.tags },
    body.reason ?? `Sticker updated by ${auth.moderator.username ?? 'a moderator'} via Pulsify`,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.sticker)
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ guildId: string; stickerId: string }> },
) {
  const { guildId, stickerId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const perms = await checkBotExpressionPerms(guildId)
  if (perms && !perms.manage) {
    return NextResponse.json(
      { error: 'The bot needs the "Manage Expressions" permission to delete stickers.' },
      { status: 403 },
    )
  }

  const result = await deleteGuildSticker(
    guildId,
    stickerId,
    `Sticker deleted by ${auth.moderator.username ?? 'a moderator'} via Pulsify`,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
