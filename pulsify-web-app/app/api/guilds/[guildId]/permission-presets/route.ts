import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import {
  ALL_PERMISSION_BITS,
  DEFAULT_PRESET_SEEDS,
  bitsFromPermissionKeys,
} from '@/lib/discord-permissions'

export type PermissionPreset = {
  id: string
  guild_id: string
  name: string
  description: string | null
  permissions: string
  is_default: boolean
  created_at: string
  updated_at: string
}

// Lists presets for a guild. Seeds Discord-template defaults on first read so
// admins always have a starting point — they can then edit or delete them.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()
  const { data: existing, error } = await supabase
    .from('role_permission_presets')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if ((existing?.length ?? 0) === 0) {
    const rows = DEFAULT_PRESET_SEEDS.map((seed) => ({
      guild_id: guildId,
      name: seed.name,
      description: seed.description,
      permissions: bitsFromPermissionKeys(seed.permissionKeys),
      is_default: true,
    }))
    const { data: inserted, error: insertErr } = await supabase
      .from('role_permission_presets')
      .insert(rows)
      .select('*')
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }
    return NextResponse.json(inserted ?? [])
  }

  return NextResponse.json(existing ?? [])
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    description?: string
    permissions?: string
  }
  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('role_permission_presets')
    .insert({
      guild_id: guildId,
      name: name.slice(0, 100),
      description: body.description?.trim().slice(0, 300) ?? null,
      permissions: sanitizePermissions(body.permissions ?? '0'),
      is_default: false,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

function sanitizePermissions(input: string): string {
  try {
    return (BigInt(input) & ALL_PERMISSION_BITS).toString()
  } catch {
    return '0'
  }
}

export { sanitizePermissions }
