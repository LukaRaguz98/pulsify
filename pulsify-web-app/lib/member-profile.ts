// Shared types for the member directory and the detailed profile page.
// The API routes assemble these from Discord (live member/role/ban data) plus
// the Supabase aggregation RPCs (activity + infractions).

import type { DiscordMember, DiscordRole } from '@/lib/discord'

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

/**
 * One row in the member directory — the live Discord member plus the activity
 * and infraction aggregates needed to render reputation + risk inline.
 */
export type DirectoryMember = {
  member: DiscordMember
  activity: MemberActivityStats
  infractions: MemberInfractions
  /** Highest assignable-role position; drives the role/staff sort + filter. */
  topRolePosition: number
  isStaff: boolean
}

export type DirectoryResponse = {
  members: DirectoryMember[]
  roles: DiscordRole[]
  /** Total guild member count from Discord (may exceed fetched members). */
  approximateMemberCount: number | null
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
}
