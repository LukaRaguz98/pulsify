import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { deleteInvite } from '@/lib/discord'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ guildId: string; code: string }> },
) {
  const { guildId, code } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const reason = new URL(req.url).searchParams.get('reason') ?? undefined
  const result = await deleteInvite(code, reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
