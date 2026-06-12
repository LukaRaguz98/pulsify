import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import {
  fetchGuildMember,
  fetchGuildRoles,
  fetchGuild,
  fetchGuildBan,
  fetchDiscordUser,
  userBannerUrl,
  snowflakeToDate,
  type DiscordMember,
} from '@/lib/discord'
import {
  EMPTY_INFRACTIONS,
  type MemberProfileBundle,
  type ProfileStats,
  type ProfileChannel,
  type ProfileDailyPoint,
  type ProfileHourPoint,
  type WarningEntry,
  type ModLogEntry,
  type ModerationNote,
  type MemberInfractions,
  type MemberLevel,
} from '@/lib/member-profile'
import { normaliseLevelingSettings } from '@/lib/leveling'
import { computeReputation, daysSince } from '@/lib/reputation'

// Window for the contribution heatmap + activity timeline.
const HEATMAP_DAYS = 119

const EMPTY_STATS: ProfileStats = {
  message_count: 0,
  command_count: 0,
  active_channels: 0,
  voice_seconds: 0,
  voice_sessions: 0,
  first_seen: null,
  last_active: null,
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string; userId: string }> },
) {
  const { guildId, userId } = await params
  // Any member may open ANY current member's profile (read-only). The moderation
  // slice — warnings, mod-logs, infractions, notes, ban — is ADMIN-ONLY: those
  // queries are skipped entirely for non-admins so the data never leaves the
  // server, and the member-facing profile UI hides those sections.
  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isAdmin = auth.access.role === 'admin'

  const supabase = await createClient()
  const dailySince = new Date(Date.now() - HEATMAP_DAYS * 86_400_000).toISOString()

  const [
    member,
    roles,
    guild,
    ban,
    fullUser,
    statsRes,
    channelsRes,
    dailyRes,
    hourlyRes,
    warningsRes,
    modLogsRes,
    infrRes,
    notesRes,
    levelRes,
    levelSettingsRes,
    globalRepRes,
  ] = await Promise.all([
    fetchGuildMember(guildId, userId),
    fetchGuildRoles(guildId),
    fetchGuild(guildId),
    isAdmin ? fetchGuildBan(guildId, userId) : Promise.resolve(null),
    fetchDiscordUser(userId),
    supabase.rpc('get_member_profile_stats', { p_guild_id: guildId, p_user_id: userId, p_since: null }),
    supabase.rpc('get_member_channel_breakdown', {
      p_guild_id: guildId,
      p_user_id: userId,
      p_since: null,
      p_limit: 8,
    }),
    supabase.rpc('get_member_activity_daily', {
      p_guild_id: guildId,
      p_user_id: userId,
      p_since: dailySince,
    }),
    supabase.rpc('get_member_hourly_activity', { p_guild_id: guildId, p_user_id: userId, p_since: null }),
    isAdmin
      ? supabase
          .from('guild_warnings')
          .select('id, reason, moderator_username, active, created_at')
          .eq('guild_id', guildId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] }),
    isAdmin
      ? supabase
          .from('moderation_logs')
          .select('id, action, reason, moderator_username, moderator_id, metadata, created_at')
          .eq('guild_id', guildId)
          .eq('target_user_id', userId)
          .neq('action', 'warn')
          .order('created_at', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] }),
    isAdmin
      ? supabase.rpc('get_guild_members_infractions', { p_guild_id: guildId })
      : Promise.resolve({ data: [] }),
    isAdmin
      ? supabase
          .from('moderation_notes')
          .select('id, body, author_id, author_username, created_at')
          .eq('guild_id', guildId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] }),
    supabase
      .from('member_levels')
      .select('xp, level')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('leveling_settings').select('enabled, settings').eq('guild_id', guildId).maybeSingle(),
    // GLOBAL reputation inputs — activity + infractions aggregated across EVERY
    // guild, so the trust score reflects the whole Pulse network (PULSIFY-45).
    supabase.rpc('get_global_member_reputation', { p_user_id: userId }),
  ])

  // The profile is GLOBAL: a leaderboard row (e.g. a global wallet holder from
  // another Pulse server) may point at someone who isn't a member of THIS guild.
  // Rather than 404, fall back to a global profile — synthesise a member shell
  // from their Discord account so identity + global reputation + cross-server
  // standing still render; the guild-specific sections are hidden client-side
  // via `isMember`. We only 404 when Discord can't resolve the account at all.
  const isMember = member !== null
  if (!member && !fullUser) {
    return NextResponse.json({ error: 'This user could not be found.' }, { status: 404 })
  }
  const resolvedMember: DiscordMember = member ?? {
    user: {
      id: userId,
      username: fullUser!.username,
      avatar: fullUser!.avatar,
      global_name: fullUser!.global_name,
      bot: false,
    },
    nick: null,
    avatar: null,
    roles: [],
    joined_at: '',
    communication_disabled_until: null,
  }

  const statRow = (statsRes.data?.[0] ?? null) as Record<string, unknown> | null
  const stats: ProfileStats = statRow
    ? {
        message_count: Number(statRow.message_count ?? 0),
        command_count: Number(statRow.command_count ?? 0),
        active_channels: Number(statRow.active_channels ?? 0),
        voice_seconds: Number(statRow.voice_seconds ?? 0),
        voice_sessions: Number(statRow.voice_sessions ?? 0),
        first_seen: (statRow.first_seen as string | null) ?? null,
        last_active: (statRow.last_active as string | null) ?? null,
      }
    : EMPTY_STATS

  const topChannels: ProfileChannel[] = ((channelsRes.data ?? []) as Record<string, unknown>[]).map(
    (r) => ({
      channel_id: String(r.channel_id),
      channel_name: (r.channel_name as string | null) ?? null,
      message_count: Number(r.message_count ?? 0),
    }),
  )

  const daily: ProfileDailyPoint[] = ((dailyRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    day: String(r.day),
    messages: Number(r.messages ?? 0),
    voice_seconds: Number(r.voice_seconds ?? 0),
  }))

  const hourly: ProfileHourPoint[] = ((hourlyRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    hour: Number(r.hour ?? 0),
    message_count: Number(r.message_count ?? 0),
  }))

  // Infractions: pick this user's row out of the guild-wide aggregate.
  const infrRow = ((infrRes.data ?? []) as Record<string, unknown>[]).find(
    (r) => String(r.user_id) === userId,
  )
  const infractions: MemberInfractions = infrRow
    ? {
        warnings: Number(infrRow.warnings ?? 0),
        active_warnings: Number(infrRow.active_warnings ?? 0),
        timeouts: Number(infrRow.timeouts ?? 0),
        kicks: Number(infrRow.kicks ?? 0),
        bans: Number(infrRow.bans ?? 0),
        total_infractions: Number(infrRow.total_infractions ?? 0),
        last_infraction_at: (infrRow.last_infraction_at as string | null) ?? null,
      }
    : { ...EMPTY_INFRACTIONS }

  const warnings = (warningsRes.data ?? []) as WarningEntry[]
  const modLogs = (modLogsRes.data ?? []) as ModLogEntry[]
  const notes = (notesRes.data ?? []) as ModerationNote[]

  const accountCreated = snowflakeToDate(userId)

  const levelRow = (levelRes.data ?? null) as Record<string, unknown> | null
  const level: MemberLevel | null = levelRow
    ? { xp: Number(levelRow.xp ?? 0), level: Number(levelRow.level ?? 0) }
    : null
  const curve = normaliseLevelingSettings(levelSettingsRes.data ?? null).curve

  // GLOBAL reputation: the existing 0-100 trust score, computed from the
  // member's activity aggregated across every Pulse server (plus account age
  // from the snowflake). Assignable roles are per-guild / live-from-Discord, so
  // they're omitted globally (a minor factor) — passed as 0.
  const grRow = (globalRepRes.data?.[0] ?? null) as Record<string, unknown> | null
  const globalReputation = computeReputation({
    accountAgeDays: daysSince(accountCreated ? accountCreated.toISOString() : null),
    tenureDays: daysSince((grRow?.first_seen as string | null) ?? null),
    messages: Number(grRow?.message_count ?? 0),
    voiceSeconds: Number(grRow?.voice_seconds ?? 0),
    commands: Number(grRow?.command_count ?? 0),
    activeChannels: Number(grRow?.active_channels ?? 0),
    assignableRoles: 0,
    warnings: Number(grRow?.warnings ?? 0),
    timeouts: Number(grRow?.timeouts ?? 0),
    kicks: Number(grRow?.kicks ?? 0),
    bans: Number(grRow?.bans ?? 0),
  })

  const bundle: MemberProfileBundle = {
    guildId,
    isMember,
    member: resolvedMember,
    roles,
    bannerUrl: fullUser?.banner ? userBannerUrl(userId, fullUser.banner, 600) : null,
    accentColor: fullUser?.accent_color ?? null,
    accountCreatedAt: accountCreated ? accountCreated.toISOString() : null,
    isOwner: guild?.owner_id === userId,
    stats,
    topChannels,
    daily,
    hourly,
    infractions,
    warnings,
    modLogs,
    notes,
    ban: { banned: ban !== null, reason: ban?.reason ?? null },
    level,
    curve,
    globalReputation,
  }

  return NextResponse.json(bundle)
}
