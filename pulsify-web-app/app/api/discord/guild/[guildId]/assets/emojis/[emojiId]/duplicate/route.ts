import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import {
  fetchGuildEmojis,
  createGuildEmoji,
  emojiAssetUrl,
  checkBotExpressionPerms,
  sanitizeExpressionName,
} from '@/lib/discord'

/**
 * Duplicate an emoji: Discord has no native copy endpoint, so we pull the
 * source image from the CDN server-side (dodging browser CORS) and re-upload it
 * under a `<name>_copy` name. Fails cleanly if the source can't be read.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string; emojiId: string }> },
) {
  const { guildId, emojiId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const perms = await checkBotExpressionPerms(guildId)
  if (perms && !perms.create) {
    return NextResponse.json(
      { error: 'The bot needs the "Manage Expressions" permission to add emojis.' },
      { status: 403 },
    )
  }

  const emojis = await fetchGuildEmojis(guildId)
  const source = emojis.find((e) => e.id === emojiId)
  if (!source) return NextResponse.json({ error: 'Emoji not found.' }, { status: 404 })

  const cdnRes = await fetch(emojiAssetUrl(source.id, source.animated, 256).split('?')[0], {
    cache: 'no-store',
  })
  if (!cdnRes.ok) {
    return NextResponse.json({ error: 'Could not read the source emoji image.' }, { status: 502 })
  }
  const mime = source.animated ? 'image/gif' : 'image/png'
  const base64 = Buffer.from(await cdnRes.arrayBuffer()).toString('base64')
  const image = `data:${mime};base64,${base64}`

  const newName = sanitizeExpressionName(`${source.name ?? 'emoji'}_copy`)
  const result = await createGuildEmoji(
    guildId,
    { name: newName, image, roles: source.roles },
    `Emoji duplicated by ${auth.moderator.username ?? 'a moderator'} via Pulsify`,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.emoji)
}
