import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { fetchGuildMembers, fetchGuildRoles, fetchGuild, snowflakeToDate, type DiscordRole } from '@/lib/discord'
import {
  EMPTY_ACTIVITY,
  EMPTY_INFRACTIONS,
  type DirectoryMember,
  type DirectoryResponse,
  type MemberActivityStats,
  type MemberInfractions,
  type MemberLevel,
} from '@/lib/member-profile'
import { normaliseLevelingSettings } from '@/lib/leveling'
import { computeReputation, daysSince } from '@/lib/reputation'

// Permission bits that mark a role (and therefore its holders) as "staff".
const STAFF_PERM_BITS = [
  BigInt(0x8), // ADMINISTRATOR
  BigInt(0x20), // MANAGE_GUILD
  BigInt(0x2), // KICK_MEMBERS
  BigInt(0x4), // BAN_MEMBERS
  BigInt(0x2000), // MANAGE_MESSAGES
  BigInt(0x10000000), // MANAGE_ROLES
  BigInt('0x10000000000'), // MODERATE_MEMBERS
]

function roleIsStaff(role: DiscordRole): boolean {
  if (role.managed) return false
  let perms: bigint
  try {
    perms = BigInt(role.permissions)
  } catch {
    return false
  }
  return STAFF_PERM_BITS.some((bit) => (perms & bit) !== BigInt(0))
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId } = await params
  // Management data — requires Manage Server / Administrator on this guild.
  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const url = new URL(req.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 1000), 1), 1000)

  const [members, roles, guild, statsRes, infrRes, levelsRes, settingsRes] = await Promise.all([
    fetchGuildMembers(guildId, limit),
    fetchGuildRoles(guildId),
    fetchGuild(guildId),
    supabase.rpc('get_guild_members_stats', { p_guild_id: guildId, p_since: null }),
    supabase.rpc('get_guild_members_infractions', { p_guild_id: guildId }),
    supabase.from('member_levels').select('user_id, xp, level').eq('guild_id', guildId),
    supabase.from('leveling_settings').select('enabled, settings').eq('guild_id', guildId).maybeSingle(),
  ])

  const levelsByUser = new Map<string, MemberLevel>()
  for (const r of (levelsRes.data ?? []) as Record<string, unknown>[]) {
    levelsByUser.set(String(r.user_id), {
      xp: Number(r.xp ?? 0),
      level: Number(r.level ?? 0),
    })
  }
  const curve = normaliseLevelingSettings(settingsRes.data ?? null).curve

  const statsByUser = new Map<string, MemberActivityStats>()
  for (const r of (statsRes.data ?? []) as Record<string, unknown>[]) {
    statsByUser.set(String(r.user_id), {
      message_count: Number(r.message_count ?? 0),
      command_count: Number(r.command_count ?? 0),
      voice_seconds: Number(r.voice_seconds ?? 0),
      last_active: (r.last_active as string | null) ?? null,
    })
  }

  const infrByUser = new Map<string, MemberInfractions>()
  for (const r of (infrRes.data ?? []) as Record<string, unknown>[]) {
    infrByUser.set(String(r.user_id), {
      warnings: Number(r.warnings ?? 0),
      active_warnings: Number(r.active_warnings ?? 0),
      timeouts: Number(r.timeouts ?? 0),
      kicks: Number(r.kicks ?? 0),
      bans: Number(r.bans ?? 0),
      total_infractions: Number(r.total_infractions ?? 0),
      last_infraction_at: (r.last_infraction_at as string | null) ?? null,
    })
  }

  // GLOBAL reputation (PULSIFY-45): one batched RPC aggregates each member's
  // activity + infractions across EVERY guild, so the directory's reputation
  // column matches the profile page and the leaderboard exactly (rather than the
  // old per-guild score). Bots are excluded.
  const humanIds = members.filter((m) => !m.user.bot).map((m) => m.user.id)
  const { data: globalRepRows } = humanIds.length
    ? await supabase.rpc('get_global_members_reputation', { p_user_ids: humanIds })
    : { data: [] as unknown }
  const globalRepById = new Map<string, Record<string, unknown>>()
  for (const r of (globalRepRows ?? []) as Record<string, unknown>[]) {
    globalRepById.set(String(r.user_id), r)
  }

  const staffRoleIds = new Set(roles.filter(roleIsStaff).map((r) => r.id))
  const rolePosById = new Map(roles.map((r) => [r.id, r.position]))

  const directory: DirectoryMember[] = members.map((m) => {
    let topRolePosition = 0
    let isStaff = false
    for (const roleId of m.roles) {
      const pos = rolePosById.get(roleId)
      if (pos !== undefined && pos > topRolePosition) topRolePosition = pos
      if (staffRoleIds.has(roleId)) isStaff = true
    }
    // Global reputation — same maths as the profile page / leaderboard: account
    // age from the snowflake, tenure + activity + infractions from the global
    // aggregate, assignable roles omitted (per-guild) so the score stays global.
    const g = globalRepById.get(m.user.id)
    const globalReputation = computeReputation({
      accountAgeDays: daysSince(snowflakeToDate(m.user.id)?.toISOString() ?? null),
      tenureDays: daysSince((g?.first_seen as string | null) ?? null),
      messages: Number(g?.message_count ?? 0),
      voiceSeconds: Number(g?.voice_seconds ?? 0),
      commands: Number(g?.command_count ?? 0),
      activeChannels: Number(g?.active_channels ?? 0),
      assignableRoles: 0,
      warnings: Number(g?.warnings ?? 0),
      timeouts: Number(g?.timeouts ?? 0),
      kicks: Number(g?.kicks ?? 0),
      bans: Number(g?.bans ?? 0),
    })
    return {
      member: m,
      activity: statsByUser.get(m.user.id) ?? EMPTY_ACTIVITY,
      infractions: infrByUser.get(m.user.id) ?? EMPTY_INFRACTIONS,
      level: levelsByUser.get(m.user.id) ?? null,
      globalReputation,
      topRolePosition,
      isStaff,
    }
  })

  const response: DirectoryResponse = {
    members: directory,
    roles,
    approximateMemberCount: guild?.approximate_member_count ?? null,
    curve,
  }
  return NextResponse.json(response)
}
