import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { duplicateGuildChannel } from '@/lib/discord'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string; channelId: string }> },
) {
  const { guildId, channelId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const reason = url.searchParams.get('reason') ?? undefined
  const result = await duplicateGuildChannel(guildId, channelId, reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.channel)
}
