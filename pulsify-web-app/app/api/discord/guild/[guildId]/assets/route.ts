import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import {
  fetchGuild,
  fetchGuildEmojis,
  fetchGuildStickers,
  fetchGuildSoundboardSounds,
  checkBotExpressionPerms,
  assetLimitsForTier,
} from '@/lib/discord'
import type { AssetsPayload } from '@/lib/assets'

/**
 * One-shot loader for the Assets page: every emoji, sticker and soundboard
 * sound, plus the guild's slot limits (driven by boost tier) and the bot's
 * expression permissions. Fetched in parallel so the page hydrates in a single
 * round-trip.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const [guild, emojis, stickers, sounds, permissions] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildEmojis(guildId),
    fetchGuildStickers(guildId),
    fetchGuildSoundboardSounds(guildId),
    checkBotExpressionPerms(guildId),
  ])

  const premiumTier = guild?.premium_tier ?? 0
  const payload: AssetsPayload = {
    emojis,
    stickers,
    sounds,
    premiumTier,
    limits: assetLimitsForTier(premiumTier),
    permissions,
  }
  return NextResponse.json(payload)
}
