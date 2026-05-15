import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { modifyGuildRole, deleteGuildRole, type RoleMutation } from '@/lib/discord'
import { sanitizeMutation } from '../route'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string; roleId: string }> },
) {
  const { guildId, roleId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as RoleMutation & { reason?: string }
  const mutation = sanitizeMutation(body)
  const result = await modifyGuildRole(guildId, roleId, mutation, body.reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.role)
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ guildId: string; roleId: string }> },
) {
  const { guildId, roleId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const reason = url.searchParams.get('reason') ?? undefined
  const result = await deleteGuildRole(guildId, roleId, reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
