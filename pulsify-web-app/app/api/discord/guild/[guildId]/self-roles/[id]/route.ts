import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { createClient } from '@/lib/supabase-server'
import { readGuildEmbedInt } from '@/lib/embed-color'
import {
  fetchGuildRoles,
  getBotHighestRolePosition,
  postChannelComponentsReturningId,
  editChannelComponents,
  deleteChannelMessage,
  type V2TopLevelComponent,
} from '@/lib/discord'
import {
  buildMenuContainer,
  normaliseMenu,
  normaliseRoles,
  normaliseRequiredRoleIds,
  normaliseMenuType,
  normaliseCategory,
  normaliseSelectionMode,
  normaliseRequiredRoleMode,
  normaliseStatus,
  validateDraft,
  SELF_ROLE_LIMITS,
  type MenuStatus,
  type MenuDraft,
} from '@/lib/self-roles'

type Ctx = { params: Promise<{ guildId: string; id: string }> }

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

export async function PATCH(req: Request, { params }: Ctx) {
  const { guildId, id } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('self_role_menus')
    .select('*')
    .eq('id', id)
    .eq('guild_id', guildId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Menu not found.' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Partial<MenuDraft> & { status?: string }

  // Merge incoming fields over the existing row (any omitted field is kept).
  const merged: MenuDraft = {
    title: body.title !== undefined ? String(body.title) : (existing.title ?? ''),
    description: body.description !== undefined ? String(body.description) : (existing.description ?? ''),
    channel_id: body.channel_id !== undefined ? String(body.channel_id) : (existing.channel_id ?? ''),
    menu_type: normaliseMenuType(body.menu_type ?? existing.menu_type),
    category: normaliseCategory(body.category ?? existing.category),
    selection_mode: normaliseSelectionMode(body.selection_mode ?? existing.selection_mode),
    min_values: body.min_values !== undefined ? Number(body.min_values) || 0 : (existing.min_values ?? 0),
    max_values: body.max_values !== undefined ? Number(body.max_values) || 0 : (existing.max_values ?? 0),
    required_role_ids: normaliseRequiredRoleIds(body.required_role_ids ?? existing.required_role_ids),
    required_role_mode: normaliseRequiredRoleMode(body.required_role_mode ?? existing.required_role_mode),
    roles: normaliseRoles(body.roles ?? existing.roles),
  }

  const targetStatus: MenuStatus = body.status ? normaliseStatus(body.status) : normaliseStatus(existing.status)

  // A draft may be saved incomplete; any other status must hold a valid menu.
  const willBeLive = targetStatus === 'active'
  if (targetStatus !== 'draft') {
    const validationError = validateDraft(merged)
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })
  }
  if (willBeLive) {
    const roleError = await validateRolesAssignable(guildId, merged.roles.map((r) => r.role_id))
    if (roleError) return NextResponse.json({ error: roleError }, { status: 400 })
  }

  const update = {
    title: merged.title.trim().slice(0, SELF_ROLE_LIMITS.maxTitle) || 'Self roles',
    description: merged.description.trim().slice(0, SELF_ROLE_LIMITS.maxDescription) || null,
    channel_id: merged.channel_id,
    menu_type: merged.menu_type,
    category: merged.category,
    selection_mode: merged.selection_mode,
    min_values: merged.min_values,
    max_values: merged.max_values,
    required_role_ids: merged.required_role_ids,
    required_role_mode: merged.required_role_mode,
    roles: merged.roles,
    status: targetStatus,
    updated_at: new Date().toISOString(),
  }

  const { data: saved, error } = await supabase
    .from('self_role_menus')
    .update(update)
    .eq('id', id)
    .eq('guild_id', guildId)
    .select('*')
    .single()
  if (error || !saved) return NextResponse.json({ error: `Failed to save: ${error?.message ?? 'unknown'}` }, { status: 500 })

  // ── Discord message side effects ──────────────────────────────────────────
  const menu = normaliseMenu(saved)
  const accent = await readGuildEmbedInt(supabase, guildId)
  if (targetStatus === 'active') {
    if (menu.message_id) {
      await editChannelComponents(menu.channel_id, menu.message_id, [
        buildMenuContainer(menu, 'active', accent) as unknown as V2TopLevelComponent,
      ])
    } else {
      const res = await postChannelComponentsReturningId(menu.channel_id, [
        buildMenuContainer(menu, 'active', accent) as unknown as V2TopLevelComponent,
      ])
      if (res.ok) {
        const { data: withMsg } = await supabase
          .from('self_role_menus')
          .update({ message_id: res.messageId })
          .eq('id', id)
          .select('*')
          .single()
        return NextResponse.json(withMsg ?? saved)
      }
      return NextResponse.json(
        { ...saved, warning: `Saved, but couldn't post the message: ${res.error}` },
      )
    }
  } else if ((targetStatus === 'disabled' || targetStatus === 'archived') && menu.message_id) {
    // Strip the controls so the posted message stops accepting input, but keep
    // it in place as a record of what was offered.
    await editChannelComponents(menu.channel_id, menu.message_id, [
      buildMenuContainer(menu, targetStatus, accent) as unknown as V2TopLevelComponent,
    ])
  }

  return NextResponse.json(saved)
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { guildId, id } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('self_role_menus')
    .select('channel_id, message_id')
    .eq('id', id)
    .eq('guild_id', guildId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Menu not found.' }, { status: 404 })

  if (existing.message_id) {
    await deleteChannelMessage(
      existing.channel_id,
      existing.message_id,
      `Self-role menu deleted by ${auth.moderator.username ?? 'staff'}`,
    )
  }
  // self_role_assignments rows cascade away via the FK on delete.
  const { error } = await supabase.from('self_role_menus').delete().eq('id', id).eq('guild_id', guildId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
