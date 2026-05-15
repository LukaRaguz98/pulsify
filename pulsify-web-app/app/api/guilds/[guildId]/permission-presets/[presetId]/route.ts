import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { sanitizePermissions } from '../route'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string; presetId: string }> },
) {
  const { guildId, presetId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    description?: string
    permissions?: string
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.name === 'string') update.name = body.name.trim().slice(0, 100)
  if (typeof body.description === 'string') {
    update.description = body.description.trim().slice(0, 300) || null
  }
  if (typeof body.permissions === 'string') {
    update.permissions = sanitizePermissions(body.permissions)
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('role_permission_presets')
    .update(update)
    .eq('guild_id', guildId)
    .eq('id', presetId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ guildId: string; presetId: string }> },
) {
  const { guildId, presetId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()
  const { error } = await supabase
    .from('role_permission_presets')
    .delete()
    .eq('guild_id', guildId)
    .eq('id', presetId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
