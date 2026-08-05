// Shared types for the member directory and the detailed profile page.
// The API routes assemble these from Discord (live member/role/ban data) plus
// the Supabase aggregation RPCs (activity + infractions).

import type { DiscordMember, DiscordRole } from '@/lib/discord'
import type { LevelCurve } from '@/lib/leveling'
import type { Reputation } from '@/lib/reputation'
import type { EconomyUser } from '@/lib/economy'

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
  /**
   * The member's GLOBAL 0-100 trust score — computed from activity aggregated
   * across every Pulse server (PULSIFY-45), exactly like the profile page and
   * leaderboard. The single canonical reputation, so the directory matches them.
   */
  globalReputation: Reputation
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
  /** False when the user isn't a member of THIS guild — the profile then falls
   *  back to a global view (identity + global reputation + cross-server Pulse
   *  standing), and the guild-specific sections are hidden. Lets any leaderboard
   *  row — including global wallet holders from other servers — open a profile. */
  isMember: boolean
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
  /**
   * The member's GLOBAL reputation — the 0-100 trust score computed from their
   * activity aggregated across every Pulse server (PULSIFY-45). This is the one
   * canonical reputation shown on the profile.
   */
  globalReputation: Reputation
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
  /** 0–100 GLOBAL reputation — computed across every Pulse server (PULSIFY-45). */
  reputation: number
  /** Messages in the selected timeframe (drives the "Most active" board). */
  messages: number
  /** Voice seconds in the selected timeframe. */
  voiceSeconds: number
}

export type LeaderboardKey = 'level' | 'xp' | 'reputation' | 'active'

/** The boards the leaderboard UI can show — the data boards plus the two
 *  consolidated ones ("Richest" from Economy, "Top inviters" from Invites).
 *  Lives here rather than in the client component so server components can
 *  validate a `?board=` deep link without importing a client module. */
export const BOARD_IDS = ['level', 'reputation', 'active', 'richest', 'invites', 'gaming'] as const

export type BoardId = (typeof BOARD_IDS)[number]

export function isBoardId(v: string | null | undefined): v is BoardId {
  return BOARD_IDS.includes(v as BoardId)
}

/** A "Richest" board row — a global wallet plus a resolved avatar URL. The
 *  holder may live on a different Pulse server: `avatar` is their guild-member
 *  avatar when they're a member here, otherwise their global Discord avatar (or
 *  the Discord default). `inGuild` is false for holders who aren't members of
 *  this guild — they have no profile here, so the row isn't clickable. */
export type RichestEntry = EconomyUser & { avatar: string; inGuild: boolean }

/** An "Invites" board row — referral ranking moved here from the Invites view
 *  so every leaderboard lives in one place (same reasoning as "Richest").
 *  `inGuild` is false for inviters who have since left: we only know them by the
 *  name stored on the join, and they have no profile here. */
export type InviteBoardEntry = {
  userId: string
  name: string
  avatar: string
  inGuild: boolean
  /** valid + bonus − fake, the ranking metric. */
  score: number
  valid: number
  retained: number
  fake: number
  bonus: number
  /** retained / valid, 0-100. */
  retentionRate: number
}

/** A "Gaming" board row — play activity ranked from the same per-member
 *  aggregate the Gaming module uses, moved here so every leaderboard lives in
 *  one place. Every metric the board can rank by travels with the row, so
 *  switching the ranking metric is a client-side sort, not another query. */
export type GamingBoardEntry = {
  userId: string
  name: string
  avatar: string
  inGuild: boolean
  playSeconds: number
  sessions: number
  avgSessionSeconds: number
  longestSeconds: number
  games: number
  favouriteGame: string | null
  currentlyPlaying: boolean
  lastPlayedAt: string | null
}

export type LeaderboardResponse = {
  boards: Record<LeaderboardKey, LeaderboardEntry[]>
  /** Top global wallets by Pulse Coin balance — the "Richest" board, moved
   *  here from the Economy view so all leaderboards live in one place. */
  richest: RichestEntry[]
  /** Top inviters by score for the selected timeframe — the "Invites" board,
   *  moved here from Engagement › Invites. */
  inviteBoard: InviteBoardEntry[]
  /** Whether invite tracking is switched on, so the empty board can say why. */
  invitesEnabled: boolean
  /** Top players by gaming activity — the "Gaming" board, moved here from
   *  Analytics › Gaming › Players. Empty unless `gamingVisible`. */
  gamingBoard: GamingBoardEntry[]
  /** Gaming exposes per-member activity, so the board is admin-only and needs
   *  the module switched on — the UI hides the whole board when this is false. */
  gamingVisible: boolean
  /** The guild's "anonymise statistics" setting: rows show a rank, not a name. */
  gamingAnonymised: boolean
  /** Members grouped into level brackets, for the distribution chart. */
  distribution: { label: string; count: number }[]
  totals: { tracked: number; totalXp: number; avgLevel: number; topLevel: number }
  /** Echoes the requested timeframe ('24h' | '7d' | '30d' | 'all'). */
  window: string
  curve: LevelCurve
}
