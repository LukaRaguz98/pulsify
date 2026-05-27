// Shared types for the member directory and the detailed profile page.
// The API routes assemble these from Discord (live member/role/ban data) plus
// the Supabase aggregation RPCs (activity + infractions).

import type { DiscordMember, DiscordRole } from '@/lib/discord'
import type { LevelCurve } from '@/lib/leveling'

/** Per-member infraction tallies (mirrors get_guild_members_infractions). */
export type MemberInfractions = {
  warnings: number
  active_warnings: number
  timeouts: number
  kicks: number
  bans: number
  total_infractions: number
  last_infraction_at: string | null
}

export const EMPTY_INFRACTIONS: MemberInfractions = {
  warnings: 0,
  active_warnings: 0,
  timeouts: 0,
  kicks: 0,
  bans: 0,
  total_infractions: 0,
  last_infraction_at: null,
}

/** Per-member activity totals (mirrors get_guild_members_stats). */
export type MemberActivityStats = {
  message_count: number
  command_count: number
  voice_seconds: number
  last_active: string | null
}

export const EMPTY_ACTIVITY: MemberActivityStats = {
  message_count: 0,
  command_count: 0,
  voice_seconds: 0,
  last_active: null,
}

/** A member's stored XP + level (from member_levels). */
export type MemberLevel = {
  /** Cumulative XP earned in this guild. */
  xp: number
  /** Level derived from xp + the guild curve (denormalised by the bot). */
  level: number
}

export const EMPTY_LEVEL: MemberLevel = { xp: 0, level: 0 }

/**
 * One row in the member directory — the live Discord member plus the activity
 * and infraction aggregates needed to render reputation + risk inline.
 */
export type DirectoryMember = {
  member: DiscordMember
  activity: MemberActivityStats
  infractions: MemberInfractions
  /** Stored XP + level, or null when the member has earned no XP yet. */
  level: MemberLevel | null
  /** Highest assignable-role position; drives the role/staff sort + filter. */
  topRolePosition: number
  isStaff: boolean
}

export type DirectoryResponse = {
  members: DirectoryMember[]
  roles: DiscordRole[]
  /** Total guild member count from Discord (may exceed fetched members). */
  approximateMemberCount: number | null
  /** The guild's XP curve, so the UI can render level progress bars. */
  curve: LevelCurve
}

// ── Profile bundle ────────────────────────────────────────────────────────

export type ProfileChannel = {
  channel_id: string
  channel_name: string | null
  message_count: number
}

export type ProfileDailyPoint = {
  day: string
  messages: number
  voice_seconds: number
}

export type ProfileHourPoint = {
  hour: number
  message_count: number
}

export type ProfileStats = {
  message_count: number
  command_count: number
  active_channels: number
  voice_seconds: number
  voice_sessions: number
  first_seen: string | null
  last_active: string | null
}

export type WarningEntry = {
  id: string
  reason: string | null
  moderator_username: string | null
  active: boolean
  created_at: string
}

export type ModLogEntry = {
  id: string
  action: string
  reason: string | null
  moderator_username: string | null
  moderator_id: string
  metadata: Record<string, unknown>
  created_at: string
}

export type ModerationNote = {
  id: string
  body: string
  author_id: string
  author_username: string | null
  created_at: string
}

export type BanInfo = {
  banned: boolean
  reason: string | null
}

/** Everything the profile page needs in a single fetch. */
export type MemberProfileBundle = {
  guildId: string
  member: DiscordMember
  roles: DiscordRole[]
  /** CDN URL for the member's profile banner image, or null when unset. */
  bannerUrl: string | null
  /** Decimal RGB profile accent colour; banner fallback when there's no image. */
  accentColor: number | null
  /** ISO timestamp the Discord account was created (from the snowflake). */
  accountCreatedAt: string | null
  /** True when this user owns the guild. */
  isOwner: boolean
  stats: ProfileStats
  topChannels: ProfileChannel[]
  daily: ProfileDailyPoint[]
  hourly: ProfileHourPoint[]
  infractions: MemberInfractions
  warnings: WarningEntry[]
  modLogs: ModLogEntry[]
  notes: ModerationNote[]
  ban: BanInfo
  /** Stored XP + level for this member, or null when none earned yet. */
  level: MemberLevel | null
  /** The guild's XP curve, for the level-progress card. */
  curve: LevelCurve
}

// ── Leaderboard bundle ──────────────────────────────────────────────────────
// The leaderboard route computes the four boards server-side (no new RPC) and
// returns top-N entries per board plus a level distribution + headline totals.

export type LeaderboardEntry = {
  userId: string
  name: string
  /** Full avatar CDN URL. */
  avatar: string
  level: number
  xp: number
  /** 0–100 reputation (all-time). */
  reputation: number
  /** Messages in the selected timeframe (drives the "Most active" board). */
  messages: number
  /** Voice seconds in the selected timeframe. */
  voiceSeconds: number
}

export type LeaderboardKey = 'level' | 'xp' | 'reputation' | 'active'

export type LeaderboardResponse = {
  boards: Record<LeaderboardKey, LeaderboardEntry[]>
  /** Members grouped into level brackets, for the distribution chart. */
  distribution: { label: string; count: number }[]
  totals: { tracked: number; totalXp: number; avgLevel: number; topLevel: number }
  /** Echoes the requested timeframe ('24h' | '7d' | '30d' | 'all'). */
  window: string
  curve: LevelCurve
}
