import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { modifyGuildSoundboardSound, deleteGuildSoundboardSound, checkBotExpressionPerms } from '@/lib/discord'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string; soundId: string }> },
) {
  const { guildId, soundId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const perms = await checkBotExpressionPerms(guildId)
  if (perms && !perms.manage) {
    return NextResponse.json(
      { error: 'The bot needs the "Manage Expressions" permission to edit sounds.' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    volume?: number
    reason?: string
  }
  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json({ error: 'A name is required.' }, { status: 400 })
  }
  const result = await modifyGuildSoundboardSound(
    guildId,
    soundId,
    { name: body.name, volume: body.volume },
    body.reason ?? `Sound updated by ${auth.moderator.username ?? 'a moderator'} via Pulsify`,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.sound)
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ guildId: string; soundId: string }> },
) {
  const { guildId, soundId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const perms = await checkBotExpressionPerms(guildId)
  if (perms && !perms.manage) {
    return NextResponse.json(
      { error: 'The bot needs the "Manage Expressions" permission to delete sounds.' },
      { status: 403 },
    )
  }

  const result = await deleteGuildSoundboardSound(
    guildId,
    soundId,
    `Sound deleted by ${auth.moderator.username ?? 'a moderator'} via Pulsify`,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
