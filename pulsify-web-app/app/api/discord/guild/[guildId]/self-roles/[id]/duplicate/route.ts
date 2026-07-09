import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { createClient } from '@/lib/supabase-server'
import { SELF_ROLE_LIMITS } from '@/lib/self-roles'

type Ctx = { params: Promise<{ guildId: string; id: string }> }

/**
 * Duplicate a menu as a fresh DRAFT — same config, no Discord message yet. The
 * admin tweaks the copy and publishes it when ready, so duplicating never posts
 * a second live menu by surprise.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { guildId, id } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()
  const { data: source } = await supabase
    .from('self_role_menus')
    .select('*')
    .eq('id', id)
    .eq('guild_id', guildId)
    .maybeSingle()
  if (!source) return NextResponse.json({ error: 'Menu not found.' }, { status: 404 })

  const now = new Date().toISOString()
  const { data: copy, error } = await supabase
    .from('self_role_menus')
    .insert({
      guild_id: guildId,
      title: `${String(source.title ?? 'Self roles')} (copy)`.slice(0, SELF_ROLE_LIMITS.maxTitle),
      description: source.description,
      channel_id: source.channel_id,
      message_id: null,
      menu_type: source.menu_type,
      category: source.category,
      selection_mode: source.selection_mode,
      min_values: source.min_values,
      max_values: source.max_values,
      required_role_ids: source.required_role_ids,
      required_role_mode: source.required_role_mode,
      roles: source.roles,
      status: 'draft',
      created_by: auth.moderator.userId,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single()
  if (error || !copy) return NextResponse.json({ error: `Failed to duplicate: ${error?.message ?? 'unknown'}` }, { status: 500 })

  return NextResponse.json(copy)
}
