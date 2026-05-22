import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import {
  fetchGuildMember,
  fetchGuildRoles,
  fetchGuild,
  fetchGuildBan,
  fetchDiscordUser,
  userBannerUrl,
  snowflakeToDate,
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
} from '@/lib/member-profile'

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
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId, userId } = await params
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
  ] = await Promise.all([
    fetchGuildMember(guildId, userId),
    fetchGuildRoles(guildId),
    fetchGuild(guildId),
    fetchGuildBan(guildId, userId),
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
    supabase
      .from('guild_warnings')
      .select('id, reason, moderator_username, active, created_at')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('moderation_logs')
      .select('id, action, reason, moderator_username, moderator_id, metadata, created_at')
      .eq('guild_id', guildId)
      .eq('target_user_id', userId)
      .neq('action', 'warn')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.rpc('get_guild_members_infractions', { p_guild_id: guildId }),
    supabase
      .from('moderation_notes')
      .select('id, body, author_id, author_username, created_at')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  if (!member) {
    return NextResponse.json(
      { error: 'This user is not currently a member of the server.' },
      { status: 404 },
    )
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

  const bundle: MemberProfileBundle = {
    guildId,
    member,
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
  }

  return NextResponse.json(bundle)
}
