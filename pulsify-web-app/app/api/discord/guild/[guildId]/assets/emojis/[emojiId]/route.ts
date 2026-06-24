import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { modifyGuildEmoji, deleteGuildEmoji, checkBotExpressionPerms } from '@/lib/discord'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string; emojiId: string }> },
) {
  const { guildId, emojiId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const perms = await checkBotExpressionPerms(guildId)
  if (perms && !perms.manage) {
    return NextResponse.json(
      { error: 'The bot needs the "Manage Expressions" permission to edit emojis.' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { name?: string; reason?: string }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'A name is required.' }, { status: 400 })
  }
  const result = await modifyGuildEmoji(
    guildId,
    emojiId,
    { name: body.name },
    body.reason ?? `Emoji renamed by ${auth.moderator.username ?? 'a moderator'} via Pulsify`,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.emoji)
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ guildId: string; emojiId: string }> },
) {
  const { guildId, emojiId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const perms = await checkBotExpressionPerms(guildId)
  if (perms && !perms.manage) {
    return NextResponse.json(
      { error: 'The bot needs the "Manage Expressions" permission to delete emojis.' },
      { status: 403 },
    )
  }

  const result = await deleteGuildEmoji(
    guildId,
    emojiId,
    `Emoji deleted by ${auth.moderator.username ?? 'a moderator'} via Pulsify`,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
