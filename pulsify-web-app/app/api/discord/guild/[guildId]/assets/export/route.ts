import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import {
  emojiAssetUrl,
  stickerFileUrl,
  soundAssetUrl,
  stickerExtension,
  type StickerFormat,
} from '@/lib/discord'
import { buildZip } from '@/lib/zip'

type ExportItem = {
  kind: 'emoji' | 'sticker' | 'sound'
  id: string
  name: string
  animated?: boolean
  format?: StickerFormat
}

// Original-file CDN URL for an asset (full size, no resize params).
function assetSourceUrl(item: ExportItem): string {
  if (item.kind === 'emoji') return emojiAssetUrl(item.id, !!item.animated, 256).split('?')[0]
  if (item.kind === 'sticker') return stickerFileUrl(item.id, (item.format ?? 1) as StickerFormat)
  return soundAssetUrl(item.id)
}

// Pick a file extension. Stickers/emojis are known up-front; sounds depend on
// the CDN's content-type (Discord stores MP3 or OGG).
function extensionFor(item: ExportItem, contentType: string | null): string {
  if (item.kind === 'emoji') return item.animated ? 'gif' : 'png'
  if (item.kind === 'sticker') return stickerExtension((item.format ?? 1) as StickerFormat)
  if (contentType?.includes('mpeg') || contentType?.includes('mp3')) return 'mp3'
  return 'ogg'
}

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '') || 'asset'
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { items?: ExportItem[]; packageName?: string }
  const items = (body.items ?? []).filter((i) => i && i.id && i.kind)
  if (items.length === 0) {
    return NextResponse.json({ error: 'No assets selected to export.' }, { status: 400 })
  }
  // Hard cap so a runaway request can't fan out into hundreds of CDN fetches.
  if (items.length > 500) {
    return NextResponse.json({ error: 'Too many assets selected (max 500).' }, { status: 400 })
  }

  // Fetch every file from the CDN server-side (avoids browser CORS on downloads).
  const fetched = await Promise.all(
    items.map(async (item) => {
      try {
        const res = await fetch(assetSourceUrl(item), { cache: 'no-store' })
        if (!res.ok) return null
        const data = Buffer.from(await res.arrayBuffer())
        return { item, data, ext: extensionFor(item, res.headers.get('content-type')) }
      } catch {
        return null
      }
    }),
  )
  const ok = fetched.filter((f): f is NonNullable<typeof f> => f !== null)
  if (ok.length === 0) {
    return NextResponse.json({ error: 'Could not download the selected assets from Discord.' }, { status: 502 })
  }

  // Single asset, no manifest requested → return the raw file directly.
  if (ok.length === 1 && !body.packageName) {
    const { item, data, ext } = ok[0]
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeFileName(item.name)}.${ext}"`,
      },
    })
  }

  // Otherwise bundle into a ZIP, de-duplicating colliding filenames and adding
  // a metadata.json manifest with naming + type info for each asset.
  const used = new Map<string, number>()
  const entries = ok.map(({ item, data, ext }) => {
    const folder = item.kind === 'emoji' ? 'emojis' : item.kind === 'sticker' ? 'stickers' : 'sounds'
    let base = `${folder}/${safeFileName(item.name)}.${ext}`
    const seen = used.get(base) ?? 0
    if (seen > 0) base = `${folder}/${safeFileName(item.name)}_${seen}.${ext}`
    used.set(base, 1)
    used.set(`${folder}/${safeFileName(item.name)}.${ext}`, seen + 1)
    return { name: base, data }
  })

  const manifest = {
    exported_at: new Date().toISOString(),
    guild_id: guildId,
    count: ok.length,
    assets: ok.map(({ item, ext }) => ({
      kind: item.kind,
      id: item.id,
      name: item.name,
      file: `${safeFileName(item.name)}.${ext}`,
      ...(item.kind === 'emoji' ? { animated: !!item.animated } : {}),
      ...(item.kind === 'sticker' ? { format: item.format } : {}),
    })),
  }
  entries.push({ name: 'metadata.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') })

  const zip = buildZip(entries)
  const fileName = safeFileName(body.packageName ?? 'pulsify-assets')
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName}.zip"`,
    },
  })
}
