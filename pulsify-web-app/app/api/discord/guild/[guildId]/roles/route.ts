import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildRoles, reorderGuildRoles } from '@/lib/discord'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId } = await params
  const roles = await fetchGuildRoles(guildId)
  return NextResponse.json(roles)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId } = await params
  const body = await req.json() as { positions: { id: string; position: number }[] }
  if (!Array.isArray(body?.positions)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const result = await reorderGuildRoles(guildId, body.positions)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
