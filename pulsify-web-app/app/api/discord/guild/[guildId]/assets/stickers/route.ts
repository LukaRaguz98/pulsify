import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { createGuildSticker, checkBotExpressionPerms } from '@/lib/discord'

// Parse a `data:<mime>;base64,<payload>` URI into its mime + bytes. Returns
// null for anything that isn't a base64 data URI.
function parseDataUri(uri: string): { mime: string; data: Buffer } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(uri)
  if (!match) return null
  try {
    return { mime: match[1], data: Buffer.from(match[2], 'base64') }
  } catch {
    return null
  }
}

const STICKER_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/apng': 'png',
  'image/gif': 'gif',
  'application/json': 'json',
}

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
      { error: 'The bot needs the "Manage Expressions" permission to add stickers.' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    description?: string
    tags?: string
    file?: string
    reason?: string
  }
  if (!body.name?.trim() || !body.file) {
    return NextResponse.json({ error: 'A name and file are required.' }, { status: 400 })
  }
  const parsed = parseDataUri(body.file)
  if (!parsed) {
    return NextResponse.json({ error: 'Sticker file must be a PNG, APNG or GIF.' }, { status: 400 })
  }
  const ext = STICKER_MIME_EXT[parsed.mime]
  if (!ext) {
    return NextResponse.json({ error: 'Stickers must be PNG, APNG or GIF (max 512 KB).' }, { status: 400 })
  }

  const result = await createGuildSticker(
    guildId,
    {
      name: body.name,
      description: body.description ?? '',
      tags: body.tags ?? body.name,
      file: { data: parsed.data, filename: `sticker.${ext}`, contentType: parsed.mime },
    },
    body.reason ?? `Sticker added by ${auth.moderator.username ?? 'a moderator'} via Pulsify`,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.sticker)
}
