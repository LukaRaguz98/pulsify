import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { fetchEventUsers } from '@/lib/discord'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string; eventId: string }> },
) {
  const { guildId, eventId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const users = await fetchEventUsers(guildId, eventId)
  return NextResponse.json(users)
}
