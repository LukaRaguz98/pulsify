import 'server-only'
import type { createClient } from '@/lib/supabase-server'
import {
  fetchGuild,
  fetchGuildChannels,
  fetchGuildRoles,
  fetchGuildEmojis,
  fetchGuildStickers,
  fetchGuildMembers,
  CHANNEL_TYPES,
} from '@/lib/discord'
import { formatServerAge, type StatType } from '@/lib/statistics-channels'

// Live statistic values for the dashboard (preview + list display), computed via
// the bot token so they don't touch the user's rate-limited Discord endpoints.
// The BOT computes its own authoritative values from the gateway cache when it
// renames channels — this is a best-effort snapshot for the UI. Member-count
// splits (humans/bots) are exact only up to the 1,000-member page Discord
// returns; larger servers fall back to an approximation here (the bot is exact).

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export type StatValues = Partial<Record<StatType, number | string | null>>

const DISCORD_EPOCH = 1_420_070_400_000
function snowflakeToMs(id: string): number {
  try {
    return Number(BigInt(id) >> 22n) + DISCORD_EPOCH
  } catch {
    return Date.now()
  }
}

async function countEvents(
  supabase: SupabaseClient,
  guildId: string,
  eventType: string,
  sinceIso?: string,
): Promise<number> {
  let q = supabase
    .from('analytics_events')
    .select('*', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .eq('event_type', eventType)
  if (sinceIso) q = q.gte('created_at', sinceIso)
  const { count } = await q
  return count ?? 0
}

/** Distinct message authors in the last 7 days (bounded so a busy server stays
 *  responsive — approximate for very active guilds). */
async function activeMemberCount(supabase: SupabaseClient, guildId: string): Promise<number> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { data } = await supabase
    .from('analytics_events')
    .select('user_id')
    .eq('guild_id', guildId)
    .eq('event_type', 'message')
    .gte('created_at', weekAgo)
    .limit(10_000)
  if (!data) return 0
  return new Set(data.map((r: { user_id: string | null }) => r.user_id).filter(Boolean)).size
}

export async function computeStatValues(
  supabase: SupabaseClient,
  guildId: string,
): Promise<StatValues> {
  const now = Date.now()
  const dayAgo = new Date(now - 86_400_000).toISOString()
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString()

  const [guild, channels, roles, emojis, stickers, members, newToday, newWeek, totalMessages, active] =
    await Promise.all([
      fetchGuild(guildId),
      fetchGuildChannels(guildId),
      fetchGuildRoles(guildId),
      fetchGuildEmojis(guildId),
      fetchGuildStickers(guildId),
      fetchGuildMembers(guildId, 1000),
      countEvents(supabase, guildId, 'member_join', dayAgo),
      countEvents(supabase, guildId, 'member_join', weekAgo),
      countEvents(supabase, guildId, 'message'),
      activeMemberCount(supabase, guildId),
    ])

  const totalMembers = guild?.approximate_member_count ?? members.length
  const botCount = members.filter((m) => m.user?.bot).length
  // Exact when the guild fits in one member page; otherwise derive humans from
  // the approximate total minus the bots we did see (close enough for preview).
  const humans = Math.max(0, totalMembers - botCount)

  const voice = channels.filter(
    (c) => c.type === CHANNEL_TYPES.VOICE || c.type === CHANNEL_TYPES.STAGE,
  ).length
  const text = channels.filter(
    (c) =>
      c.type === CHANNEL_TYPES.TEXT ||
      c.type === CHANNEL_TYPES.ANNOUNCEMENT ||
      c.type === CHANNEL_TYPES.FORUM ||
      c.type === CHANNEL_TYPES.MEDIA,
  ).length
  const nonCategory = channels.filter((c) => c.type !== CHANNEL_TYPES.CATEGORY).length

  const createdMs = snowflakeToMs(guildId)

  return {
    total_members: totalMembers,
    humans,
    bots: botCount,
    online: guild?.approximate_presence_count ?? null,
    boosts: guild?.premium_subscription_count ?? 0,
    boost_level: guild?.premium_tier ?? 0,
    roles: roles.length,
    channels: nonCategory,
    voice_channels: voice,
    text_channels: text,
    emojis: emojis.length,
    stickers: stickers.length,
    server_age: formatServerAge(createdMs, now),
    new_today: newToday,
    new_week: newWeek,
    total_messages: totalMessages,
    active_members: active,
  }
}
