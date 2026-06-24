import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { createGuildEmoji, checkBotExpressionPerms } from '@/lib/discord'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const perms = await checkBotExpressionPerms(guildId)
  if (perms && !perms.create) {
    return NextResponse.json(
      { error: 'The bot needs the "Manage Expressions" permission to add emojis.' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { name?: string; image?: string; reason?: string }
  if (!body.name?.trim() || !body.image) {
    return NextResponse.json({ error: 'A name and image are required.' }, { status: 400 })
  }
  if (!body.image.startsWith('data:image/')) {
    return NextResponse.json({ error: 'Emoji must be a PNG, JPEG or GIF image.' }, { status: 400 })
  }

  const result = await createGuildEmoji(
    guildId,
    { name: body.name, image: body.image },
    body.reason ?? `Emoji added by ${auth.moderator.username ?? 'a moderator'} via Pulsify`,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.emoji)
}
