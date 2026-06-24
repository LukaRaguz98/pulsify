import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { createClient } from '@/lib/supabase-server'
import { recordNotification } from '@/lib/notifications-server'
import { recordTempRoleEvent } from '@/lib/temporary-roles-server'
import {
  fetchGuildRoles,
  addMemberRoleDiscord,
  getBotHighestRolePosition,
} from '@/lib/discord'
import {
  addDuration,
  validateExpiry,
  isTempRoleSource,
  DURATION_UNITS,
  type DurationUnit,
  type TempRoleSource,
} from '@/lib/temporary-roles'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()
  const [assignmentsRes, eventsRes] = await Promise.all([
    supabase
      .from('temporary_roles')
      .select('*')
      .eq('guild_id', guildId)
      .order('assigned_at', { ascending: false })
      .limit(1000),
    supabase
      .from('temporary_role_events')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  return NextResponse.json({
    assignments: assignmentsRes.data ?? [],
    events: eventsRes.data ?? [],
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    userId?: string
    userName?: string
    roleId?: string
    source?: string
    reason?: string
    duration?: { value: number; unit: DurationUnit }
    expiresAt?: string
    notifyUser?: boolean
    notifyAdmin?: boolean
  }

  if (!body.userId || !body.roleId) {
    return NextResponse.json({ error: 'A member and role are required.' }, { status: 400 })
  }

  // Resolve the expiry: either an explicit ISO date or a {value, unit} duration.
  let expiresAt: Date
  if (body.expiresAt) {
    expiresAt = new Date(body.expiresAt)
  } else if (body.duration && DURATION_UNITS.includes(body.duration.unit)) {
    expiresAt = addDuration(new Date(), body.duration.value, body.duration.unit)
  } else {
    return NextResponse.json({ error: 'An expiration is required.' }, { status: 400 })
  }
  const expiryError = validateExpiry(expiresAt)
  if (expiryError) return NextResponse.json({ error: expiryError }, { status: 400 })

  const source: TempRoleSource = isTempRoleSource(body.source) ? body.source : 'manual'

  // The role must still exist and sit below the bot in the hierarchy, or Discord
  // will reject the add — fail with a clear message rather than a raw 403.
  const roles = await fetchGuildRoles(guildId)
  const role = roles.find((r) => r.id === body.roleId)
  if (!role) return NextResponse.json({ error: 'That role no longer exists.' }, { status: 400 })
  if (role.managed) return NextResponse.json({ error: 'Managed roles cannot be assigned.' }, { status: 400 })
  const botHighest = await getBotHighestRolePosition(guildId)
  if (botHighest != null && role.position >= botHighest) {
    return NextResponse.json(
      { error: `"${role.name}" is above Pulse's highest role — move Pulse's role above it first.` },
      { status: 400 },
    )
  }

  const reason = (body.reason ?? '').slice(0, 300) || `Temporary role via Pulsify (${source})`
  const added = await addMemberRoleDiscord(guildId, body.userId, body.roleId, `Temporary role: ${reason}`)
  if (!added.ok) return NextResponse.json({ error: added.error }, { status: 400 })

  const supabase = await createClient()
  const now = new Date().toISOString()

  // Re-granting an already-active temporary role extends it rather than erroring
  // on the partial-unique index.
  const { data: existing } = await supabase
    .from('temporary_roles')
    .select('id')
    .eq('guild_id', guildId)
    .eq('user_id', body.userId)
    .eq('role_id', body.roleId)
    .eq('status', 'active')
    .maybeSingle()

  const shared = {
    user_name: body.userName ?? null,
    role_name: role.name,
    source,
    reason,
    expires_at: expiresAt.toISOString(),
    notify_user: !!body.notifyUser,
    notify_admin: !!body.notifyAdmin,
    expiry_warned_at: null,
    updated_at: now,
  }

  let row
  if (existing) {
    const { data, error } = await supabase
      .from('temporary_roles')
      .update(shared)
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    row = data
  } else {
    const { data, error } = await supabase
      .from('temporary_roles')
      .insert({
        guild_id: guildId,
        user_id: body.userId,
        role_id: body.roleId,
        assigned_by: auth.moderator.userId,
        assigned_by_name: auth.moderator.username,
        assigned_at: now,
        status: 'active',
        ...shared,
      })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    row = data
  }

  await recordTempRoleEvent(supabase, {
    guildId,
    temporaryRoleId: row.id,
    userId: body.userId,
    userName: body.userName,
    roleId: body.roleId,
    roleName: role.name,
    action: 'assigned',
    source,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    detail: { expires_at: row.expires_at, reason },
  })

  if (body.notifyAdmin) {
    await recordNotification({
      guildId,
      type: 'temp_role_assigned',
      title: `${auth.moderator.username ?? 'A moderator'} granted @${role.name} temporarily`,
      body: `Expires ${new Date(row.expires_at).toLocaleString()}`,
      link: `/dashboard/${guildId}/roles?tab=temporary`,
      actorId: auth.moderator.userId,
      actorName: auth.moderator.username,
      actorUsername: auth.moderator.handle,
      targetId: body.userId,
      targetName: body.userName ?? null,
      metadata: { role_id: body.roleId, source, temporary_role_id: row.id },
    })
  }

  return NextResponse.json(row)
}
