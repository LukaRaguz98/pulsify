import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { createClient } from '@/lib/supabase-server'
import { readGuildEmbedInt } from '@/lib/embed-color'
import {
  fetchGuildRoles,
  getBotHighestRolePosition,
  postChannelComponentsReturningId,
  type V2TopLevelComponent,
} from '@/lib/discord'
import {
  buildMenuContainer,
  normaliseMenu,
  normaliseRoles,
  normaliseRequiredRoleIds,
  validateDraft,
  normaliseMenuType,
  normaliseCategory,
  normaliseSelectionMode,
  normaliseRequiredRoleMode,
  SELF_ROLE_LIMITS,
  type MenuDraft,
} from '@/lib/self-roles'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()
  const [menusRes, assignmentsRes] = await Promise.all([
    supabase
      .from('self_role_menus')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(500),
    // Cap the analytics window so a busy server stays responsive — the most
    // recent assignments power the trend + most/least-selected leaderboards.
    supabase
      .from('self_role_assignments')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(5000),
  ])

  return NextResponse.json({
    menus: menusRes.data ?? [],
    assignments: assignmentsRes.data ?? [],
  })
}

/**
 * Validate that every role in the draft can actually be self-assigned by the
 * bot: it must still exist, not be managed, and sit below the bot's highest
 * role. Returns an error string, or null when all roles are assignable.
 */
async function validateRolesAssignable(guildId: string, roleIds: string[]): Promise<string | null> {
  if (roleIds.length === 0) return null
  const roles = await fetchGuildRoles(guildId)
  const byId = new Map(roles.map((r) => [r.id, r]))
  const botHighest = await getBotHighestRolePosition(guildId)
  for (const id of roleIds) {
    const role = byId.get(id)
    if (!role) return 'One of the selected roles no longer exists.'
    if (role.managed) return `"${role.name}" is a managed role and can't be self-assigned.`
    if (botHighest != null && role.position >= botHighest) {
      return `"${role.name}" is above Pulse's highest role — move Pulse's role above it first.`
    }
  }
  return null
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Partial<MenuDraft> & { publish?: boolean }

  const draft: MenuDraft = {
    title: String(body.title ?? ''),
    description: String(body.description ?? ''),
    channel_id: String(body.channel_id ?? ''),
    menu_type: normaliseMenuType(body.menu_type),
    category: normaliseCategory(body.category),
    selection_mode: normaliseSelectionMode(body.selection_mode),
    min_values: Number(body.min_values) || 0,
    max_values: Number(body.max_values) || 0,
    required_role_ids: normaliseRequiredRoleIds(body.required_role_ids),
    required_role_mode: normaliseRequiredRoleMode(body.required_role_mode),
    roles: normaliseRoles(body.roles),
  }

  const validationError = validateDraft(draft)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const publish = body.publish !== false // default: publish on create
  if (publish) {
    const roleError = await validateRolesAssignable(guildId, draft.roles.map((r) => r.role_id))
    if (roleError) return NextResponse.json({ error: roleError }, { status: 400 })
  }

  const supabase = await createClient()
  const now = new Date().toISOString()
  const insert = {
    guild_id: guildId,
    title: draft.title.trim().slice(0, SELF_ROLE_LIMITS.maxTitle),
    description: draft.description.trim().slice(0, SELF_ROLE_LIMITS.maxDescription) || null,
    channel_id: draft.channel_id,
    menu_type: draft.menu_type,
    category: draft.category,
    selection_mode: draft.selection_mode,
    min_values: draft.min_values,
    max_values: draft.max_values,
    required_role_ids: draft.required_role_ids,
    required_role_mode: draft.required_role_mode,
    roles: draft.roles,
    status: publish ? 'active' : 'draft',
    created_by: auth.moderator.userId,
    created_at: now,
    updated_at: now,
  }

  const { data: inserted, error } = await supabase
    .from('self_role_menus')
    .insert(insert)
    .select('*')
    .single()
  if (error || !inserted) {
    return NextResponse.json({ error: `Failed to create menu: ${error?.message ?? 'unknown error'}` }, { status: 500 })
  }

  let row = inserted
  // Post the interactive message for a published menu; a draft stays unposted
  // until the admin publishes it.
  if (publish) {
    const menu = normaliseMenu(row)
    const accent = await readGuildEmbedInt(supabase, guildId)
    const res = await postChannelComponentsReturningId(draft.channel_id, [
      buildMenuContainer(menu, 'active', accent) as unknown as V2TopLevelComponent,
    ])
    if (!res.ok) {
      await supabase.from('self_role_menus').delete().eq('id', row.id)
      return NextResponse.json({ error: `Couldn't post the menu: ${res.error}` }, { status: 400 })
    }
    const { data: updated } = await supabase
      .from('self_role_menus')
      .update({ message_id: res.messageId })
      .eq('id', row.id)
      .select('*')
      .single()
    if (updated) row = updated
  }

  return NextResponse.json(row)
}
