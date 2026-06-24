import {
  emojiAssetUrl,
  stickerAssetUrl,
  soundAssetUrl,
  snowflakeToDate,
  STICKER_FORMAT_NAMES,
  type DiscordEmoji,
  type DiscordSticker,
  type DiscordSoundboardSound,
  type StickerFormat,
} from '@/lib/discord'
import type { AssetKind } from '@/lib/assets'

/**
 * One normalized shape the grid/list/preview all render from, regardless of
 * whether the source is an emoji, sticker or sound. Built once in AssetsContent
 * so the presentational components stay dumb.
 */
export type AssetItem = {
  kind: AssetKind
  id: string
  name: string
  /** Visual preview URL (img) — null for non-rasterisable assets (Lottie). */
  previewUrl: string | null
  /** Playable URL for sounds. */
  audioUrl: string | null
  /** Short type label shown on the tile (e.g. "Animated", "GIF", "Sound"). */
  typeLabel: string
  animated?: boolean
  format?: StickerFormat
  description?: string | null
  tags?: string
  volume?: number
  available: boolean
  uploader?: string | null
  createdAt: number | null
}

function uploaderName(user?: { username: string; global_name: string | null }): string | null {
  if (!user) return null
  return user.global_name ?? user.username ?? null
}

export function emojiToItem(e: DiscordEmoji): AssetItem {
  return {
    kind: 'emoji',
    id: e.id,
    name: e.name ?? 'unnamed',
    previewUrl: emojiAssetUrl(e.id, e.animated, 96),
    audioUrl: null,
    typeLabel: e.animated ? 'Animated' : 'Static',
    animated: e.animated,
    available: e.available,
    uploader: uploaderName(e.user),
    createdAt: snowflakeToDate(e.id)?.getTime() ?? null,
  }
}

export function stickerToItem(s: DiscordSticker): AssetItem {
  return {
    kind: 'sticker',
    id: s.id,
    name: s.name,
    previewUrl: stickerAssetUrl(s.id, s.format_type, 160),
    audioUrl: null,
    typeLabel: STICKER_FORMAT_NAMES[s.format_type] ?? 'Sticker',
    format: s.format_type,
    description: s.description,
    tags: s.tags,
    available: s.available,
    uploader: uploaderName(s.user),
    createdAt: snowflakeToDate(s.id)?.getTime() ?? null,
  }
}

export function soundToItem(s: DiscordSoundboardSound): AssetItem {
  return {
    kind: 'sound',
    id: s.sound_id,
    name: s.name,
    previewUrl: null,
    audioUrl: soundAssetUrl(s.sound_id),
    typeLabel: 'Sound',
    volume: s.volume,
    available: s.available,
    uploader: uploaderName(s.user),
    createdAt: snowflakeToDate(s.sound_id)?.getTime() ?? null,
  }
}

/** Payload shape POSTed to the export route for a given asset. */
export function exportRefFor(item: AssetItem) {
  return {
    kind: item.kind,
    id: item.id,
    name: item.name,
    animated: item.animated,
    format: item.format,
  }
}
