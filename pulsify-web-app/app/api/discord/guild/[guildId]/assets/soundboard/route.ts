import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { createGuildSoundboardSound, checkBotExpressionPerms } from '@/lib/discord'

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
      { error: 'The bot needs the "Manage Expressions" permission to add sounds.' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    sound?: string
    volume?: number
    reason?: string
  }
  if (!body.name?.trim() || !body.sound) {
    return NextResponse.json({ error: 'A name and sound file are required.' }, { status: 400 })
  }
  // Discord only accepts MP3 / OGG soundboard uploads, as a base64 data URI.
  if (!/^data:audio\/(mpeg|mp3|ogg)/.test(body.sound)) {
    return NextResponse.json({ error: 'Sounds must be MP3 or OGG (max 512 KB, 5.2s).' }, { status: 400 })
  }

  const result = await createGuildSoundboardSound(
    guildId,
    { name: body.name, sound: body.sound, volume: body.volume },
    body.reason ?? `Sound added by ${auth.moderator.username ?? 'a moderator'} via Pulsify`,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.sound)
}
