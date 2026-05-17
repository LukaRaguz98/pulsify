import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { createChannelInvite, fetchGuildInvites, type InviteCreate } from '@/lib/discord'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const invites = await fetchGuildInvites(guildId)
  return NextResponse.json(invites)
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string
    max_age?: number
    max_uses?: number
    temporary?: boolean
    unique?: boolean
    reason?: string
  }
  if (!body.channel_id) {
    return NextResponse.json({ error: 'channel_id is required.' }, { status: 400 })
  }

  const opts: InviteCreate = {
    max_age: body.max_age,
    max_uses: body.max_uses,
    temporary: body.temporary,
    unique: body.unique,
  }
  const result = await createChannelInvite(body.channel_id, opts, body.reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.invite)
}
