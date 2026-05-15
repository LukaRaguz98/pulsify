import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { modifyGuildEvent, deleteGuildEvent, type EventMutation } from '@/lib/discord'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string; eventId: string }> },
) {
  const { guildId, eventId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as EventMutation & { reason?: string }
  const result = await modifyGuildEvent(guildId, eventId, body, body.reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.event)
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ guildId: string; eventId: string }> },
) {
  const { guildId, eventId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const reason = url.searchParams.get('reason') ?? undefined
  const result = await deleteGuildEvent(guildId, eventId, reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
