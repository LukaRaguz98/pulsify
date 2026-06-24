// Shared model + pure helpers for the Server › Assets dashboard.
//
// Used on BOTH sides of the wire: the GET route shapes its response as
// `AssetsPayload`, and the client renders/searches/sorts from the same types.
// Everything here is pure (no bot-token access), so it's safe to import into
// client components — the CDN-URL helpers it re-exports from lib/discord live
// in the pure section of that module.

import {
  assetLimitsForTier,
  type AssetLimits,
  type DiscordEmoji,
  type DiscordSticker,
  type DiscordSoundboardSound,
  type ExpressionPerms,
} from './discord'

export type AssetKind = 'emoji' | 'sticker' | 'sound'

/** Everything the Assets page needs in one fetch. */
export type AssetsPayload = {
  emojis: DiscordEmoji[]
  stickers: DiscordSticker[]
  sounds: DiscordSoundboardSound[]
  limits: AssetLimits
  premiumTier: number
  permissions: ExpressionPerms | null
}

export type AssetStats = {
  totalEmojis: number
  staticEmojis: number
  animatedEmojis: number
  totalStickers: number
  totalSounds: number
  /** Remaining capacity across all three categories (negative clamped to 0). */
  freeEmojiStatic: number
  freeEmojiAnimated: number
  freeStickers: number
  freeSounds: number
}

export function computeAssetStats(payload: AssetsPayload): AssetStats {
  const animatedEmojis = payload.emojis.filter((e) => e.animated).length
  const staticEmojis = payload.emojis.length - animatedEmojis
  const { limits } = payload
  const free = (cap: number, used: number) => Math.max(0, cap - used)
  return {
    totalEmojis: payload.emojis.length,
    staticEmojis,
    animatedEmojis,
    totalStickers: payload.stickers.length,
    totalSounds: payload.sounds.length,
    freeEmojiStatic: free(limits.emojiStatic, staticEmojis),
    freeEmojiAnimated: free(limits.emojiAnimated, animatedEmojis),
    freeStickers: free(limits.stickers, payload.stickers.length),
    freeSounds: free(limits.soundboard, payload.sounds.length),
  }
}

export type SortKey = 'name' | 'newest' | 'oldest'

/** Case-insensitive substring match used by every category's search box. */
export function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  return q === '' || name.toLowerCase().includes(q)
}

export const EMOJI_FILTERS = ['all', 'static', 'animated'] as const
export type EmojiFilter = (typeof EMOJI_FILTERS)[number]

export const STICKER_FILTERS = ['all', 'png', 'apng', 'gif', 'lottie'] as const
export type StickerFilter = (typeof STICKER_FILTERS)[number]

/** Percentage (0..100) of a capacity pool that is used. */
export function usagePct(used: number, cap: number): number {
  if (cap <= 0) return 0
  return Math.min(100, Math.round((used / cap) * 100))
}

export function formatVolume(volume: number): string {
  return `${Math.round(volume * 100)}%`
}

export { assetLimitsForTier }
