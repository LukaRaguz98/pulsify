const DISCORD_API = 'https://discord.com/api/v10'

export type DiscordGuild = {
  id: string
  name: string
  icon: string | null
  owner: boolean
  permissions: string
  features: string[]
  approximate_member_count?: number
  approximate_presence_count?: number
}

export type DiscordGuildFull = {
  id: string
  name: string
  icon: string | null
  description: string | null
  owner_id: string
  member_count: number
  approximate_member_count: number
  approximate_presence_count: number
  /** 0=NONE, 1=LOW, 2=MEDIUM, 3=HIGH, 4=VERY_HIGH. */
  verification_level?: 0 | 1 | 2 | 3 | 4
  /** 0=ALL_MESSAGES, 1=ONLY_MENTIONS. */
  default_message_notifications?: 0 | 1
  /** 0=DISABLED, 1=MEMBERS_WITHOUT_ROLES, 2=ALL_MEMBERS. */
  explicit_content_filter?: 0 | 1 | 2
  /** 0=NONE, 1=TIER_1, 2=TIER_2, 3=TIER_3. */
  premium_tier?: 0 | 1 | 2 | 3
  premium_subscription_count?: number
  afk_channel_id?: string | null
  afk_timeout?: number
  system_channel_id?: string | null
  rules_channel_id?: string | null
  public_updates_channel_id?: string | null
  preferred_locale?: string
  vanity_url_code?: string | null
  banner?: string | null
  splash?: string | null
  features?: string[]
}

export type DiscordPermissionOverwrite = {
  /** Role or member ID. */
  id: string
  /** 0 = role, 1 = member. */
  type: 0 | 1
  /** Bitfield string. */
  allow: string
  /** Bitfield string. */
  deny: string
}

export type DiscordChannel = {
  id: string
  name: string
  type: number
  position: number
  parent_id: string | null
  topic: string | null
  nsfw?: boolean
  /** Slowmode, in seconds (text channels). */
  rate_limit_per_user?: number
  /** Voice bitrate, in bps. */
  bitrate?: number
  /** Voice user cap (0 = unlimited). */
  user_limit?: number
  /** Voice region override; null = automatic. */
  rtc_region?: string | null
  /** Last message id — used to estimate activity by snowflake age. */
  last_message_id?: string | null
  permission_overwrites?: DiscordPermissionOverwrite[]
  /** Auto-archive duration for threads, in minutes. */
  default_auto_archive_duration?: number
}

/** Discord channel-type IDs we render in the dashboard. */
export const CHANNEL_TYPES = {
  TEXT: 0,
  VOICE: 2,
  CATEGORY: 4,
  ANNOUNCEMENT: 5,
  STAGE: 13,
  FORUM: 15,
  MEDIA: 16,
} as const

export type CreatableChannelType = 0 | 2 | 4 | 5 | 13 | 15 | 16

export type DiscordRole = {
  id: string
  name: string
  color: number
  position: number
  permissions: string
  managed: boolean
  mentionable: boolean
  hoist: boolean
}

export type DiscordScheduledEvent = {
  id: string
  guild_id: string
  name: string
  description: string | null
  scheduled_start_time: string
  scheduled_end_time: string | null
  status: 1 | 2 | 3 | 4
  entity_type: 1 | 2 | 3
  entity_metadata: { location?: string } | null
  image: string | null
  user_count?: number
  creator?: {
    id: string
    username: string
    avatar: string | null
  }
}

export type DiscordBan = {
  reason: string | null
  user: {
    id: string
    username: string
    global_name: string | null
    avatar: string | null
    discriminator: string
  }
}

export type EnrichedBan = DiscordBan & {
  moderator: { id: string; username: string } | null
  banned_at: string | null
  source: 'pulsify' | 'audit_log' | null
}

export type DiscordMember = {
  user: {
    id: string
    username: string
    avatar: string | null
    global_name: string | null
    bot?: boolean
  }
  nick: string | null
  /** Per-guild member avatar hash (distinct from the global user avatar). */
  avatar?: string | null
  roles: string[]
  joined_at: string
  communication_disabled_until?: string | null
}

export function guildIconUrl(guildId: string, icon: string | null, size = 64): string {
  if (!icon) return ''
  const ext = icon.startsWith('a_') ? 'gif' : 'webp'
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${ext}?size=${size}`
}

export function userBannerUrl(userId: string, banner: string | null, size = 480): string {
  if (!banner) return ''
  const ext = banner.startsWith('a_') ? 'gif' : 'webp'
  return `https://cdn.discordapp.com/banners/${userId}/${banner}.${ext}?size=${size}`
}

export function avatarUrl(userId: string, avatar: string | null, discriminator = '0', size = 64): string {
  if (!avatar) {
    const index = Number(discriminator) % 5
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`
  }
  const ext = avatar.startsWith('a_') ? 'gif' : 'webp'
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${ext}?size=${size}`
}

export function roleColor(color: number): string {
  if (color === 0) return '#99aab5'
  return `#${color.toString(16).padStart(6, '0')}`
}

export function hasManageGuild(permissions: string): boolean {
  const perms = BigInt(permissions)
  return (perms & BigInt(32)) !== BigInt(0) || (perms & BigInt(8)) !== BigInt(0)
}

export function botInviteUrl(guildId?: string): string {
  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID ?? ''
  const base = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot+applications.commands`
  return guildId ? `${base}&guild_id=${guildId}` : base
}

export type DiscordSelfUser = {
  id: string
  username: string
  discriminator: string
  global_name: string | null
  avatar: string | null
  banner: string | null
  accent_color: number | null
  banner_color: string | null
}

export async function fetchSelfUser(accessToken: string): Promise<DiscordSelfUser | null> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    next: { revalidate: 60 },
  })
  if (!res.ok) return null
  return res.json()
}

export class DiscordFetchError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'DiscordFetchError'
    this.status = status
  }
}

export async function fetchUserGuilds(accessToken: string): Promise<DiscordGuild[]> {
  // `cache: 'no-store'` skips the Next.js data cache deliberately. Previously
  // we used `next: { revalidate: 30 }`, which cached transient 429/5xx
  // responses from Discord for the revalidate window — surfacing as bogus
  // "you are not a member" errors that only cleared after the cache expired.
  // The user-guilds payload is small and per-user, so the extra fetch cost is
  // marginal compared to the UX hit of sticky failures.
  const res = await fetch(`${DISCORD_API}/users/@me/guilds?with_counts=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new DiscordFetchError(
      `Discord user-guilds fetch failed (${res.status})`,
      res.status,
    )
  }
  return res.json()
}

export async function fetchGuild(guildId: string): Promise<DiscordGuildFull | null> {
  if (!process.env.DISCORD_BOT_TOKEN) return null
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}?with_counts=true`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    next: { revalidate: 60 },
  })
  if (!res.ok) return null
  return res.json()
}

/** Force a fresh fetch of the guild — skips Next's data cache. Use after PATCH. */
export async function fetchGuildFresh(guildId: string): Promise<DiscordGuildFull | null> {
  if (!process.env.DISCORD_BOT_TOKEN) return null
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}?with_counts=true`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

export type GuildMutation = {
  name?: string
  /** Base64 data URI ("data:image/png;base64,…"). null clears the icon. */
  icon?: string | null
  verification_level?: 0 | 1 | 2 | 3 | 4
  default_message_notifications?: 0 | 1
  explicit_content_filter?: 0 | 1 | 2
  afk_channel_id?: string | null
  afk_timeout?: number
  system_channel_id?: string | null
  rules_channel_id?: string | null
  public_updates_channel_id?: string | null
}

function guildMutationToBody(m: GuildMutation): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (m.name !== undefined) body.name = m.name.slice(0, 100)
  if (m.icon !== undefined) body.icon = m.icon
  if (m.verification_level !== undefined) body.verification_level = m.verification_level
  if (m.default_message_notifications !== undefined) {
    body.default_message_notifications = m.default_message_notifications
  }
  if (m.explicit_content_filter !== undefined) body.explicit_content_filter = m.explicit_content_filter
  if (m.afk_channel_id !== undefined) body.afk_channel_id = m.afk_channel_id
  if (m.afk_timeout !== undefined) {
    // Discord only accepts: 60, 300, 900, 1800, 3600.
    body.afk_timeout = m.afk_timeout
  }
  if (m.system_channel_id !== undefined) body.system_channel_id = m.system_channel_id
  if (m.rules_channel_id !== undefined) body.rules_channel_id = m.rules_channel_id
  if (m.public_updates_channel_id !== undefined) {
    body.public_updates_channel_id = m.public_updates_channel_id
  }
  return body
}

export async function modifyGuild(
  guildId: string,
  mutation: GuildMutation,
  reason?: string,
): Promise<{ ok: true; guild: DiscordGuildFull } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const body = guildMutationToBody(mutation)
  if (Object.keys(body).length === 0) {
    return { ok: false, error: 'No changes to save.' }
  }
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}`, {
    method: 'PATCH',
    headers: jsonHeaders(reason),
    body: JSON.stringify(body),
  })
  if (!res.ok) return { ok: false, error: await discordError(res) }
  return { ok: true, guild: (await res.json()) as DiscordGuildFull }
}

export type DiscordInvite = {
  code: string
  channel: { id: string; name: string; type: number } | null
  inviter: {
    id: string
    username: string
    global_name: string | null
    avatar: string | null
  } | null
  uses: number
  max_uses: number
  max_age: number
  temporary: boolean
  created_at: string | null
  expires_at: string | null
}

export async function fetchGuildInvites(guildId: string): Promise<DiscordInvite[]> {
  if (!process.env.DISCORD_BOT_TOKEN) return []
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/invites`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    cache: 'no-store',
  })
  if (!res.ok) return []
  return res.json()
}

export type InviteCreate = {
  max_age?: number
  max_uses?: number
  temporary?: boolean
  unique?: boolean
}

export async function createChannelInvite(
  channelId: string,
  params: InviteCreate,
  reason?: string,
): Promise<{ ok: true; invite: DiscordInvite } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const body: Record<string, unknown> = {}
  if (params.max_age !== undefined) body.max_age = Math.max(0, Math.min(604800, params.max_age))
  if (params.max_uses !== undefined) body.max_uses = Math.max(0, Math.min(100, params.max_uses))
  if (params.temporary !== undefined) body.temporary = params.temporary
  if (params.unique !== undefined) body.unique = params.unique
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/invites`, {
    method: 'POST',
    headers: jsonHeaders(reason),
    body: JSON.stringify(body),
  })
  if (!res.ok) return { ok: false, error: await discordError(res) }
  return { ok: true, invite: (await res.json()) as DiscordInvite }
}

export async function deleteInvite(code: string, reason?: string): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(`${DISCORD_API}/invites/${code}`, {
    method: 'DELETE',
    headers: authHeaders(reason),
  })
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

export async function fetchGuildChannels(guildId: string): Promise<DiscordChannel[]> {
  if (!process.env.DISCORD_BOT_TOKEN) return []
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    next: { revalidate: 60 },
  })
  if (!res.ok) return []
  return res.json()
}

export async function fetchGuildRoles(guildId: string): Promise<DiscordRole[]> {
  if (!process.env.DISCORD_BOT_TOKEN) return []
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    next: { revalidate: 60 },
  })
  if (!res.ok) return []
  return res.json()
}

export async function fetchGuildEvents(guildId: string): Promise<DiscordScheduledEvent[]> {
  if (!process.env.DISCORD_BOT_TOKEN) return []
  const res = await fetch(
    `${DISCORD_API}/guilds/${guildId}/scheduled-events?with_user_count=true`,
    {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      cache: 'no-store',
    }
  )
  if (!res.ok) {
    // Throwing instead of swallowing — previously returned [] looked
    // indistinguishable from "no events" to the client, so transient 429s
    // would briefly blank the events list on rapid refreshes.
    throw new DiscordFetchError(
      `Discord guild-events fetch failed (${res.status})`,
      res.status,
    )
  }
  return res.json()
}

export type EventMutation = {
  name?: string
  description?: string | null
  channel_id?: string | null
  /** External-only location string (max 100). */
  location?: string | null
  /** ISO timestamp. */
  scheduled_start_time?: string
  /** ISO timestamp. Required for external events. */
  scheduled_end_time?: string | null
  /** 1=Stage, 2=Voice, 3=External. */
  entity_type?: 1 | 2 | 3
  /** 1=Scheduled, 2=Active, 3=Completed, 4=Canceled. PATCH-only field. */
  status?: 1 | 2 | 3 | 4
  /** Base64 data URI ("data:image/png;base64,…"). null clears the cover. */
  image?: string | null
}

// Translates our flat mutation shape into Discord's wire format.
// Drops fields that weren't explicitly provided so PATCH calls only send the
// keys the user intended to change.
function eventMutationToBody(m: EventMutation): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (m.name !== undefined) body.name = m.name.slice(0, 100)
  if (m.description !== undefined) body.description = m.description?.slice(0, 1000) ?? null
  if (m.channel_id !== undefined) body.channel_id = m.channel_id
  if (m.scheduled_start_time !== undefined) body.scheduled_start_time = m.scheduled_start_time
  if (m.scheduled_end_time !== undefined) body.scheduled_end_time = m.scheduled_end_time
  if (m.entity_type !== undefined) body.entity_type = m.entity_type
  if (m.location !== undefined) {
    body.entity_metadata = m.location ? { location: m.location.slice(0, 100) } : null
  }
  if (m.status !== undefined) body.status = m.status
  if (m.image !== undefined) body.image = m.image
  // Discord requires privacy_level=2 (GUILD_ONLY) for all guild events.
  if (m.entity_type !== undefined) body.privacy_level = 2
  return body
}

export async function createGuildEvent(
  guildId: string,
  mutation: EventMutation,
  reason?: string,
): Promise<{ ok: true; event: DiscordScheduledEvent } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/scheduled-events`, {
    method: 'POST',
    headers: jsonHeaders(reason),
    body: JSON.stringify(eventMutationToBody(mutation)),
  })
  if (!res.ok) return { ok: false, error: await discordError(res) }
  return { ok: true, event: (await res.json()) as DiscordScheduledEvent }
}

export async function modifyGuildEvent(
  guildId: string,
  eventId: string,
  mutation: EventMutation,
  reason?: string,
): Promise<{ ok: true; event: DiscordScheduledEvent } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/scheduled-events/${eventId}`, {
    method: 'PATCH',
    headers: jsonHeaders(reason),
    body: JSON.stringify(eventMutationToBody(mutation)),
  })
  if (!res.ok) return { ok: false, error: await discordError(res) }
  return { ok: true, event: (await res.json()) as DiscordScheduledEvent }
}

export async function deleteGuildEvent(
  guildId: string,
  eventId: string,
  reason?: string,
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/scheduled-events/${eventId}`, {
    method: 'DELETE',
    headers: authHeaders(reason),
  })
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

export type EventUser = {
  guild_scheduled_event_id: string
  user: {
    id: string
    username: string
    global_name: string | null
    avatar: string | null
  }
}

export async function fetchEventUsers(
  guildId: string,
  eventId: string,
  limit = 100,
): Promise<EventUser[]> {
  if (!process.env.DISCORD_BOT_TOKEN) return []
  const res = await fetch(
    `${DISCORD_API}/guilds/${guildId}/scheduled-events/${eventId}/users?limit=${Math.min(100, limit)}`,
    { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }, cache: 'no-store' },
  )
  if (!res.ok) return []
  return res.json()
}

export async function fetchGuildBans(guildId: string): Promise<DiscordBan[]> {
  if (!process.env.DISCORD_BOT_TOKEN) return []
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/bans?limit=100`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    cache: 'no-store',
  })
  if (!res.ok) return []
  return res.json()
}

/**
 * Look up a single ban by user id. Returns the ban (with reason) when the user
 * is banned, or null when they aren't (Discord 404s for non-banned users) or
 * the lookup can't be performed. Cheaper than scanning the whole ban list when
 * you only care about one member.
 */
export async function fetchGuildBan(
  guildId: string,
  userId: string,
): Promise<DiscordBan | null> {
  if (!process.env.DISCORD_BOT_TOKEN) return null
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/bans/${userId}`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

export type DiscordUser = {
  id: string
  username: string
  global_name: string | null
  avatar: string | null
  /** Profile banner hash — only returned by the full /users/{id} fetch, NOT
   *  by the guild-member endpoint. */
  banner: string | null
  /** Decimal RGB profile accent colour; null when unset. */
  accent_color: number | null
}

/**
 * Fetch a user's full Discord profile by id (bot token). Unlike the guild
 * member object, this includes the profile `banner` and `accent_color`.
 * Returns null when the token is missing or the lookup fails.
 */
export async function fetchDiscordUser(userId: string): Promise<DiscordUser | null> {
  if (!process.env.DISCORD_BOT_TOKEN) return null
  const res = await fetch(`${DISCORD_API}/users/${userId}`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    next: { revalidate: 300 },
  })
  if (!res.ok) return null
  return res.json()
}

// Discord audit log action types — only the ones we care about.
export const AUDIT_LOG_ACTION = {
  MEMBER_BAN_ADD: 22,
  MEMBER_BAN_REMOVE: 23,
  MEMBER_UPDATE: 24,
} as const

export type AuditLogChange = {
  key: string
  new_value?: unknown
  old_value?: unknown
}

export type AuditLogEntry = {
  id: string
  user_id: string | null
  target_id: string | null
  action_type: number
  reason: string | null
  changes?: AuditLogChange[]
}

export type AuditLogUser = {
  id: string
  username: string
  global_name: string | null
  avatar: string | null
}

export type AuditLogResponse = {
  audit_log_entries: AuditLogEntry[]
  users: AuditLogUser[]
}

export async function fetchGuildAuditLog(
  guildId: string,
  actionType: number,
  limit = 100,
): Promise<AuditLogResponse | null> {
  if (!process.env.DISCORD_BOT_TOKEN) return null
  const res = await fetch(
    `${DISCORD_API}/guilds/${guildId}/audit-logs?action_type=${actionType}&limit=${Math.min(100, limit)}`,
    {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      cache: 'no-store',
    },
  )
  if (!res.ok) return null
  return res.json()
}

export async function fetchGuildMembers(guildId: string, limit = 100): Promise<DiscordMember[]> {
  if (!process.env.DISCORD_BOT_TOKEN) return []
  const res = await fetch(
    `${DISCORD_API}/guilds/${guildId}/members?limit=${limit}`,
    {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      next: { revalidate: 60 },
    }
  )
  if (!res.ok) return []
  return res.json()
}

export async function isBotInGuild(guildId: string): Promise<boolean> {
  if (!process.env.DISCORD_BOT_TOKEN) return false
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    cache: 'no-store',
  })
  return res.ok
}

export type BotPermissions = {
  inGuild: boolean
  administrator: boolean
  banMembers: boolean
  kickMembers: boolean
  moderateMembers: boolean
  manageNicknames: boolean
  manageRoles: boolean
  manageMessages: boolean
  manageChannels: boolean
  sendMessages: boolean
  viewAuditLog: boolean
  /** Lets the bot change its OWN nickname — required for per-server branding. */
  changeNickname: boolean
}

const EMPTY_PERMS: BotPermissions = {
  inGuild: false,
  administrator: false,
  banMembers: false,
  kickMembers: false,
  moderateMembers: false,
  manageNicknames: false,
  manageRoles: false,
  manageMessages: false,
  manageChannels: false,
  sendMessages: false,
  viewAuditLog: false,
  changeNickname: false,
}

const PERM_BITS = {
  ADMINISTRATOR:    BigInt(0x8),
  KICK_MEMBERS:     BigInt(0x2),
  BAN_MEMBERS:      BigInt(0x4),
  MANAGE_CHANNELS:  BigInt(0x10),
  VIEW_AUDIT_LOG:   BigInt(0x80),
  SEND_MESSAGES:    BigInt(0x800),
  MANAGE_MESSAGES:  BigInt(0x2000),
  CHANGE_NICKNAME:  BigInt(0x4000000),
  MANAGE_NICKNAMES: BigInt(0x8000000),
  MANAGE_ROLES:     BigInt(0x10000000),
  // 1 << 40 = 0x10000000000 — Moderate Members (timeout)
  MODERATE_MEMBERS: BigInt('0x10000000000'),
}

let cachedBotId: string | null = null

async function getBotId(): Promise<string | null> {
  if (cachedBotId) return cachedBotId
  if (!process.env.DISCORD_BOT_TOKEN) return null

  // The bot token's /users/@me is authoritative — prefer it over the env var,
  // which can be stale or refer to a different application.
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      cache: 'no-store',
    })
    if (res.ok) {
      const me: { id: string } = await res.json()
      cachedBotId = me.id
      return cachedBotId
    }
  } catch {
    // fall through to env var
  }

  if (process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID) {
    cachedBotId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID
    return cachedBotId
  }
  return null
}

/**
 * Returns the bot's effective permissions in a guild.
 *
 * Returns `null` when we can't verify (no bot token, can't determine bot ID,
 * or the member lookup fails). Callers should treat `null` as "unknown" — do
 * not block actions; let Discord enforce instead.
 */
export async function checkBotPermissions(guildId: string): Promise<BotPermissions | null> {
  if (!process.env.DISCORD_BOT_TOKEN) return null
  const botId = await getBotId()
  if (!botId) return null

  const [memberRes, roles] = await Promise.all([
    fetch(`${DISCORD_API}/guilds/${guildId}/members/${botId}`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      cache: 'no-store',
    }),
    fetchGuildRoles(guildId),
  ])

  if (!memberRes.ok) {
    // 404 = unknown member (bot not in guild); other = transient. Either way,
    // we can't determine perms. Caller treats as "unknown".
    return memberRes.status === 404 ? EMPTY_PERMS : null
  }
  const member: { roles: string[] } = await memberRes.json()
  const botRoleIds = new Set(member.roles)

  let permissions = BigInt(0)
  for (const role of roles) {
    // include @everyone role (same id as guild) and bot's assigned roles
    if (role.id === guildId || botRoleIds.has(role.id)) {
      permissions |= BigInt(role.permissions)
    }
  }

  const isAdmin = (permissions & PERM_BITS.ADMINISTRATOR) !== BigInt(0)
  if (isAdmin) {
    return {
      inGuild: true,
      administrator: true,
      banMembers: true,
      kickMembers: true,
      moderateMembers: true,
      manageNicknames: true,
      manageRoles: true,
      manageMessages: true,
      manageChannels: true,
      sendMessages: true,
      viewAuditLog: true,
      changeNickname: true,
    }
  }

  function has(bit: bigint): boolean {
    return (permissions & bit) !== BigInt(0)
  }

  return {
    inGuild: true,
    administrator: false,
    banMembers:      has(PERM_BITS.BAN_MEMBERS),
    kickMembers:     has(PERM_BITS.KICK_MEMBERS),
    moderateMembers: has(PERM_BITS.MODERATE_MEMBERS),
    manageNicknames: has(PERM_BITS.MANAGE_NICKNAMES),
    manageRoles:     has(PERM_BITS.MANAGE_ROLES),
    manageMessages:  has(PERM_BITS.MANAGE_MESSAGES),
    manageChannels:  has(PERM_BITS.MANAGE_CHANNELS),
    sendMessages:    has(PERM_BITS.SEND_MESSAGES),
    viewAuditLog:    has(PERM_BITS.VIEW_AUDIT_LOG),
    changeNickname:  has(PERM_BITS.CHANGE_NICKNAME),
  }
}

export type DiscordResult = { ok: true } | { ok: false; error: string }

// Bare auth — use for DELETE / PUT requests that send no body. Setting
// Content-Type: application/json on a body-less request makes Discord try to
// parse an empty body as JSON and reject with 50109.
function authHeaders(reason?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
  }
  if (reason) {
    // Discord audit log reason header has a 512-char limit and must be ASCII-safe.
    headers['X-Audit-Log-Reason'] = encodeURIComponent(reason.slice(0, 500))
  }
  return headers
}

// Use when sending a JSON body.
function jsonHeaders(reason?: string): Record<string, string> {
  return { ...authHeaders(reason), 'Content-Type': 'application/json' }
}

async function discordError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({})) as { message?: string; code?: number }
  if (!body.message) return `Discord API error ${res.status}`

  if (body.code === 50013) {
    return (`You can't manage members with "Administrator" role.`)
  }
  if (body.code === 50001) {
    return `The bot can't see the channel or member.`
  }
  return body.code ? `${body.message} (${body.code})` : body.message
}

export async function unbanUser(
  guildId: string,
  userId: string,
  reason?: string,
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/bans/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(reason),
  })

  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

export async function banGuildMember(
  guildId: string,
  userId: string,
  opts: { reason?: string; deleteMessageSeconds?: number } = {},
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const body: Record<string, unknown> = {}
  if (typeof opts.deleteMessageSeconds === 'number') {
    // Discord accepts 0 — 604800 (7 days).
    body.delete_message_seconds = Math.max(0, Math.min(604800, opts.deleteMessageSeconds))
  }
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/bans/${userId}`, {
    method: 'PUT',
    headers: jsonHeaders(opts.reason),
    body: JSON.stringify(body),
  })
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

export async function kickGuildMember(
  guildId: string,
  userId: string,
  reason?: string,
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(reason),
  })
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

async function patchGuildMember(
  guildId: string,
  userId: string,
  body: Record<string, unknown>,
  reason?: string,
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    method: 'PATCH',
    headers: jsonHeaders(reason),
    body: JSON.stringify(body),
  })
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

export function timeoutMemberDiscord(
  guildId: string,
  userId: string,
  untilIso: string,
  reason?: string,
): Promise<DiscordResult> {
  return patchGuildMember(guildId, userId, { communication_disabled_until: untilIso }, reason)
}

export function clearMemberTimeoutDiscord(
  guildId: string,
  userId: string,
  reason?: string,
): Promise<DiscordResult> {
  return patchGuildMember(guildId, userId, { communication_disabled_until: null }, reason)
}

export function setMemberNicknameDiscord(
  guildId: string,
  userId: string,
  nick: string | null,
  reason?: string,
): Promise<DiscordResult> {
  return patchGuildMember(guildId, userId, { nick }, reason)
}

export async function addMemberRoleDiscord(
  guildId: string,
  userId: string,
  roleId: string,
  reason?: string,
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(
    `${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    { method: 'PUT', headers: authHeaders(reason) },
  )
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

export async function removeMemberRoleDiscord(
  guildId: string,
  userId: string,
  roleId: string,
  reason?: string,
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(
    `${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    { method: 'DELETE', headers: authHeaders(reason) },
  )
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

export async function deleteChannelMessage(
  channelId: string,
  messageId: string,
  reason?: string,
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(
    `${DISCORD_API}/channels/${channelId}/messages/${messageId}`,
    { method: 'DELETE', headers: authHeaders(reason) },
  )
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

export async function bulkDeleteChannelMessages(
  channelId: string,
  messageIds: string[],
  reason?: string,
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  if (messageIds.length === 0) return { ok: true }
  if (messageIds.length === 1) {
    return deleteChannelMessage(channelId, messageIds[0], reason)
  }
  // Discord bulk-delete accepts 2 — 100 messages younger than 2 weeks.
  const ids = messageIds.slice(0, 100)
  const res = await fetch(
    `${DISCORD_API}/channels/${channelId}/messages/bulk-delete`,
    {
      method: 'POST',
      headers: jsonHeaders(reason),
      body: JSON.stringify({ messages: ids }),
    },
  )
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

export type DiscordMessage = {
  id: string
  channel_id: string
  content: string
  timestamp: string
  edited_timestamp: string | null
  author: {
    id: string
    username: string
    avatar: string | null
    global_name: string | null
    bot?: boolean
  }
  attachments: { id: string; filename: string; url: string }[]
}

export async function fetchChannelMessages(
  channelId: string,
  limit = 50,
): Promise<DiscordMessage[]> {
  if (!process.env.DISCORD_BOT_TOKEN) return []
  const res = await fetch(
    `${DISCORD_API}/channels/${channelId}/messages?limit=${Math.min(100, limit)}`,
    {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      cache: 'no-store',
    },
  )
  if (!res.ok) return []
  return res.json()
}

export async function fetchGuildMember(
  guildId: string,
  userId: string,
): Promise<DiscordMember | null> {
  if (!process.env.DISCORD_BOT_TOKEN) return null
  const res = await fetch(
    `${DISCORD_API}/guilds/${guildId}/members/${userId}`,
    {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      cache: 'no-store',
    },
  )
  if (!res.ok) return null
  return res.json()
}

export type HierarchyCheck = { ok: true } | { ok: false; reason: string }

/**
 * Pre-flight: refuses moderation actions Discord will reject anyway.
 *
 *  - Bot can never moderate itself.
 *  - Bot can never moderate the server owner — even with Administrator.
 *  - Bot can only moderate members whose highest role is *below* the bot's
 *    highest role. Equal positions count as too high.
 *
 * Fails open (returns ok: true) when any lookup fails, so transient errors
 * don't block legitimate actions — Discord still enforces.
 */
export async function checkBotCanAct(
  guildId: string,
  targetUserId: string,
): Promise<HierarchyCheck> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: true }
  const botId = await getBotId()
  if (!botId) return { ok: true }

  if (targetUserId === botId) {
    return { ok: false, reason: 'The bot cannot moderate itself.' }
  }

  const [guildRes, botMember, targetMember, roles] = await Promise.all([
    fetch(`${DISCORD_API}/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      cache: 'no-store',
    }),
    fetchGuildMember(guildId, botId),
    fetchGuildMember(guildId, targetUserId),
    fetchGuildRoles(guildId),
  ])

  if (!guildRes.ok || !botMember || !targetMember || roles.length === 0) {
    return { ok: true } // can't determine — let Discord enforce
  }

  const guild = (await guildRes.json()) as { owner_id: string }
  if (targetUserId === guild.owner_id) {
    return {
      ok: false,
      reason: 'Discord does not allow bots to moderate the server owner.',
    }
  }

  const highestRoleFor = (memberRoles: string[]): { position: number; role: DiscordRole | null } => {
    let best: { position: number; role: DiscordRole | null } = { position: 0, role: null }
    for (const role of roles) {
      if (memberRoles.includes(role.id) && role.position > best.position) {
        best = { position: role.position, role }
      }
    }
    return best
  }
  const botHighest = highestRoleFor(botMember.roles)
  const targetHighest = highestRoleFor(targetMember.roles)

  if (botHighest.position <= targetHighest.position) {
    const targetName = targetHighest.role ? `"${targetHighest.role.name}"` : "the target member's highest role"
    const botName = botHighest.role ? `"${botHighest.role.name}"` : "the bot's role"
    return {
      ok: false,
      reason:
        `${botName} role must be above ${targetName} to perform this action.`
    }
  }

  return { ok: true }
}

export function formatEventStatus(status: 1 | 2 | 3 | 4): string {
  return { 1: 'Scheduled', 2: 'Active', 3: 'Completed', 4: 'Cancelled' }[status]
}

export function formatEntityType(type: 1 | 2 | 3): string {
  return { 1: 'Stage', 2: 'Voice', 3: 'External' }[type]
}

export async function reorderGuildRoles(
  guildId: string,
  positions: { id: string; position: number }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(positions),
  })

  if (res.ok) return { ok: true }
  const body = await res.json().catch(() => ({})) as { message?: string }
  return { ok: false, error: body.message ?? `Discord API error ${res.status}` }
}

export type RoleMutation = {
  name?: string
  /** Decimal RGB int. 0 strips the color (Discord renders default). */
  color?: number
  permissions?: string
  hoist?: boolean
  mentionable?: boolean
}

export async function createGuildRole(
  guildId: string,
  body: RoleMutation,
  reason?: string,
): Promise<{ ok: true; role: DiscordRole } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
    method: 'POST',
    headers: jsonHeaders(reason),
    body: JSON.stringify(body),
  })
  if (!res.ok) return { ok: false, error: await discordError(res) }
  return { ok: true, role: (await res.json()) as DiscordRole }
}

export async function modifyGuildRole(
  guildId: string,
  roleId: string,
  body: RoleMutation,
  reason?: string,
): Promise<{ ok: true; role: DiscordRole } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles/${roleId}`, {
    method: 'PATCH',
    headers: jsonHeaders(reason),
    body: JSON.stringify(body),
  })
  if (!res.ok) return { ok: false, error: await discordError(res) }
  return { ok: true, role: (await res.json()) as DiscordRole }
}

export async function deleteGuildRole(
  guildId: string,
  roleId: string,
  reason?: string,
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles/${roleId}`, {
    method: 'DELETE',
    headers: authHeaders(reason),
  })
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

/**
 * Returns the bot's highest role position in the guild, or null if it can't
 * be determined. Used by the role-management gates to refuse edits to roles
 * at or above the bot's hierarchy line — Discord will reject those anyway.
 */
export async function getBotHighestRolePosition(guildId: string): Promise<number | null> {
  if (!process.env.DISCORD_BOT_TOKEN) return null
  const botId = await getBotId()
  if (!botId) return null
  const [botMember, roles] = await Promise.all([
    fetchGuildMember(guildId, botId),
    fetchGuildRoles(guildId),
  ])
  if (!botMember || roles.length === 0) return null
  let max = 0
  for (const role of roles) {
    if (botMember.roles.includes(role.id) && role.position > max) max = role.position
  }
  return max
}

const DISCORD_EPOCH_MS = BigInt('1420070400000')

/** Convert a Discord snowflake ID to its creation Date, or null if invalid. */
export function snowflakeToDate(id: string): Date | null {
  try {
    const ms = (BigInt(id) >> BigInt(22)) + DISCORD_EPOCH_MS
    return new Date(Number(ms))
  } catch {
    return null
  }
}

export function channelTypeName(type: number): string {
  const types: Record<number, string> = {
    0: 'Text',
    2: 'Voice',
    4: 'Category',
    5: 'Announcement',
    13: 'Stage',
    15: 'Forum',
    16: 'Media',
  }
  return types[type] ?? 'Unknown'
}

export async function postChannelMessage(
  channelId: string,
  content: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  })
  if (res.ok) return { ok: true }
  const body = await res.json().catch(() => ({})) as { message?: string }
  return { ok: false, error: body.message ?? `Discord API error ${res.status}` }
}

/**
 * Discord embed payload. Mirrors the API shape; only the fields we actually
 * use are typed. Callers can pass any subset.
 */
export type DiscordEmbedPayload = {
  color?: number
  title?: string
  description?: string
  url?: string
  timestamp?: string
  author?: { name: string; icon_url?: string; url?: string }
  thumbnail?: { url: string }
  image?: { url: string }
  footer?: { text: string; icon_url?: string }
  fields?: { name: string; value: string; inline?: boolean }[]
}

export async function postChannelEmbed(
  channelId: string,
  embed: DiscordEmbedPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ embeds: [embed] }),
  })
  if (res.ok) return { ok: true }
  const body = await res.json().catch(() => ({})) as { message?: string }
  return { ok: false, error: body.message ?? `Discord API error ${res.status}` }
}

// ─── Discord Components V2 ──────────────────────────────────────────────────
//
// Sets the IS_COMPONENTS_V2 message flag (1 << 15) so Discord renders the
// `components` field with the rich Container/Section/TextDisplay set rather
// than the legacy embed pipeline. V2 messages CANNOT carry `content`,
// `embeds`, `stickers` or `poll` — anything in those fields is rejected.

const IS_COMPONENTS_V2_FLAG = 1 << 15 // 32768

export type V2TextDisplay = { type: 10; content: string }
export type V2Separator = { type: 14; divider?: boolean; spacing?: 1 | 2 }
export type V2Thumbnail = { type: 11; media: { url: string }; description?: string; spoiler?: boolean }
export type V2Button =
  | { type: 2; style: 1 | 2 | 3 | 4; label: string; custom_id: string; disabled?: boolean }
  | { type: 2; style: 5; label: string; url: string; disabled?: boolean }
export type V2Section = {
  type: 9
  components: V2TextDisplay[]
  accessory: V2Thumbnail | V2Button
}
export type V2ActionRow = { type: 1; components: V2Button[] }
export type V2Container = {
  type: 17
  accent_color?: number
  spoiler?: boolean
  components: (V2TextDisplay | V2Separator | V2Section | V2ActionRow)[]
}
export type V2TopLevelComponent = V2Container | V2TextDisplay | V2Separator | V2Section | V2ActionRow

/** Inline file uploaded alongside the message. Reference inside components
 *  via `attachment://<filename>` in any media.url field. */
export type V2Attachment = { filename: string; data: Buffer; contentType?: string }

export async function postChannelComponents(
  channelId: string,
  components: V2TopLevelComponent[],
  attachments?: V2Attachment[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }

  const hasFiles = attachments && attachments.length > 0
  const payload: Record<string, unknown> = {
    flags: IS_COMPONENTS_V2_FLAG,
    components,
  }
  if (hasFiles) {
    // Discord requires an `attachments` manifest pairing each file id with
    // its filename so the API can resolve `attachment://filename` URLs
    // embedded in component media fields.
    payload.attachments = attachments!.map((a, i) => ({ id: i, filename: a.filename }))
  }

  const headers: Record<string, string> = {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
  }

  let body: string | FormData
  if (hasFiles) {
    const form = new FormData()
    form.append('payload_json', JSON.stringify(payload))
    attachments!.forEach((a, i) => {
      const blob = new Blob([new Uint8Array(a.data)], { type: a.contentType ?? 'application/octet-stream' })
      form.append(`files[${i}]`, blob, a.filename)
    })
    body = form
    // Intentionally NOT setting Content-Type — FormData adds the multipart
    // boundary itself; overriding strips it and Discord rejects the upload.
  } else {
    body = JSON.stringify(payload)
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers,
    body,
  })
  if (res.ok) return { ok: true }
  const errBody = await res.json().catch(() => ({})) as { message?: string }
  return { ok: false, error: errBody.message ?? `Discord API error ${res.status}` }
}

/**
 * Open (or fetch) the DM channel with a user and return its id. Discord
 * dedupes — repeated calls return the same channel. Returns null when the bot
 * token is missing or Discord refuses to open the channel. Note: a successful
 * open does NOT guarantee the user accepts DMs; that surfaces as an error when
 * you actually post (handled by the caller as best-effort).
 */
export async function openDMChannel(userId: string): Promise<string | null> {
  if (!process.env.DISCORD_BOT_TOKEN) return null
  const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: userId }),
  })
  if (!res.ok) return null
  const dm = (await res.json()) as { id?: string }
  return dm.id ?? null
}

let cachedBotAvatarUrl: string | null | undefined = undefined

/**
 * URL to the bot's own Discord avatar. Used as the author icon in embeds.
 * Cached after the first lookup; returns null when the bot token is missing
 * or the bot has no custom avatar set.
 */
export async function getBotAvatarUrl(): Promise<string | null> {
  if (cachedBotAvatarUrl !== undefined) return cachedBotAvatarUrl
  if (!process.env.DISCORD_BOT_TOKEN) {
    cachedBotAvatarUrl = null
    return null
  }
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      cachedBotAvatarUrl = null
      return null
    }
    const me: { id: string; avatar: string | null } = await res.json()
    cachedBotAvatarUrl = me.avatar
      ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128`
      : null
    return cachedBotAvatarUrl
  } catch {
    cachedBotAvatarUrl = null
    return null
  }
}

export type DiscordBotUser = {
  id: string
  username: string
  global_name: string | null
  avatar: string | null
}

let cachedBotUser: DiscordBotUser | null | undefined = undefined

/**
 * The bot's own global Discord identity (default name + avatar). Cached for the
 * process. Used as the fallback when a guild has no custom Pulse branding.
 */
export async function getBotUser(): Promise<DiscordBotUser | null> {
  if (cachedBotUser !== undefined) return cachedBotUser
  if (!process.env.DISCORD_BOT_TOKEN) {
    cachedBotUser = null
    return null
  }
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      cachedBotUser = null
      return null
    }
    cachedBotUser = (await res.json()) as DiscordBotUser
    return cachedBotUser
  } catch {
    cachedBotUser = null
    return null
  }
}

/** CDN URL for a member's per-guild avatar, or '' when unset. */
export function guildMemberAvatarUrl(
  guildId: string,
  userId: string,
  avatarHash: string | null,
  size = 128,
): string {
  if (!avatarHash) return ''
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'webp'
  return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${avatarHash}.${ext}?size=${size}`
}

/** Fetch the bot's own member object in a guild (its nick + per-guild avatar). */
export async function fetchBotGuildMember(guildId: string): Promise<DiscordMember | null> {
  const botId = await getBotId()
  if (!botId) return null
  return fetchGuildMember(guildId, botId)
}

export type BotMemberMutation = {
  /** New nickname. null clears it (back to the default username). Omit to leave unchanged. */
  nick?: string | null
  /** Base64 data URI ("data:image/png;base64,…"). null clears the guild avatar. Omit to leave unchanged. */
  avatar?: string | null
}

/**
 * Update the bot's OWN member in a guild — its per-server nickname and avatar.
 * Maps to `PATCH /guilds/{guild.id}/members/@me`. Per-guild avatars aren't
 * available in every server (Discord gates them), so a rejected avatar surfaces
 * as a normal error string for the caller to show ("where Discord allows it").
 */
export async function modifyBotGuildMember(
  guildId: string,
  mutation: BotMemberMutation,
  reason?: string,
): Promise<{ ok: true; member: DiscordMember } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const body: Record<string, unknown> = {}
  if (mutation.nick !== undefined) body.nick = mutation.nick ? mutation.nick.slice(0, 32) : null
  if (mutation.avatar !== undefined) body.avatar = mutation.avatar
  if (Object.keys(body).length === 0) return { ok: false, error: 'No branding changes to apply.' }

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/@me`, {
    method: 'PATCH',
    headers: jsonHeaders(reason),
    body: JSON.stringify(body),
  })
  if (!res.ok) return { ok: false, error: await discordError(res) }
  return { ok: true, member: (await res.json()) as DiscordMember }
}

export type ChannelCreate = {
  name: string
  type: CreatableChannelType
  parent_id?: string | null
  topic?: string | null
  nsfw?: boolean
  rate_limit_per_user?: number
  bitrate?: number
  user_limit?: number
  position?: number
}

/**
 * Discord rejects voice/category names with most punctuation but is much
 * stricter on text channels — those must be lowercase, dashes-only. Normalize
 * up-front so the user doesn't see "Invalid Form Body" for a stray uppercase.
 */
function normalizeChannelName(name: string, type: CreatableChannelType): string {
  const trimmed = name.trim().slice(0, 100)
  if (type === 4 || type === 2 || type === 13) {
    // Categories and voice channels keep case and spaces.
    return trimmed || 'channel'
  }
  return (
    trimmed
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 100) || 'channel'
  )
}

export async function createGuildChannel(
  guildId: string,
  params: ChannelCreate,
  reason?: string,
): Promise<{ ok: true; channel: DiscordChannel } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }

  const body: Record<string, unknown> = {
    name: normalizeChannelName(params.name, params.type),
    type: params.type,
  }
  if (params.parent_id !== undefined) body.parent_id = params.parent_id
  if (params.topic !== undefined) body.topic = params.topic?.slice(0, 1024) ?? null
  if (params.nsfw !== undefined) body.nsfw = params.nsfw
  if (params.rate_limit_per_user !== undefined) {
    body.rate_limit_per_user = Math.max(0, Math.min(21600, params.rate_limit_per_user))
  }
  if (params.bitrate !== undefined) body.bitrate = Math.max(8000, params.bitrate)
  if (params.user_limit !== undefined) {
    body.user_limit = Math.max(0, Math.min(99, params.user_limit))
  }
  if (params.position !== undefined) body.position = params.position

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: jsonHeaders(reason),
    body: JSON.stringify(body),
  })
  if (!res.ok) return { ok: false, error: await discordError(res) }
  return { ok: true, channel: (await res.json()) as DiscordChannel }
}

export type ChannelMutation = {
  name?: string
  topic?: string | null
  nsfw?: boolean
  rate_limit_per_user?: number
  bitrate?: number
  user_limit?: number
  parent_id?: string | null
  position?: number
  rtc_region?: string | null
}

/**
 * Sanitize a channel patch to the fields Discord accepts and clamp them to
 * Discord's documented limits. Skips any keys the caller didn't set so the
 * PATCH only touches what changed.
 */
function channelMutationToBody(m: ChannelMutation, type: number): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (m.name !== undefined) {
    body.name = normalizeChannelName(m.name, type as CreatableChannelType)
  }
  if (m.topic !== undefined) body.topic = m.topic?.slice(0, 1024) ?? null
  if (m.nsfw !== undefined) body.nsfw = m.nsfw
  if (m.rate_limit_per_user !== undefined) {
    body.rate_limit_per_user = Math.max(0, Math.min(21600, m.rate_limit_per_user))
  }
  if (m.bitrate !== undefined) body.bitrate = Math.max(8000, m.bitrate)
  if (m.user_limit !== undefined) body.user_limit = Math.max(0, Math.min(99, m.user_limit))
  if (m.parent_id !== undefined) body.parent_id = m.parent_id
  if (m.position !== undefined) body.position = m.position
  if (m.rtc_region !== undefined) body.rtc_region = m.rtc_region
  return body
}

export async function fetchChannel(channelId: string): Promise<DiscordChannel | null> {
  if (!process.env.DISCORD_BOT_TOKEN) return null
  const res = await fetch(`${DISCORD_API}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

export async function modifyChannel(
  channelId: string,
  mutation: ChannelMutation,
  channelType: number,
  reason?: string,
): Promise<{ ok: true; channel: DiscordChannel } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(`${DISCORD_API}/channels/${channelId}`, {
    method: 'PATCH',
    headers: jsonHeaders(reason),
    body: JSON.stringify(channelMutationToBody(mutation, channelType)),
  })
  if (!res.ok) return { ok: false, error: await discordError(res) }
  return { ok: true, channel: (await res.json()) as DiscordChannel }
}

export async function deleteChannel(
  channelId: string,
  reason?: string,
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(`${DISCORD_API}/channels/${channelId}`, {
    method: 'DELETE',
    headers: authHeaders(reason),
  })
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

/**
 * Bulk reorder channels and re-parent in one call. Discord accepts an array
 * where each entry can independently change position, parent_id, and an
 * optional lock_permissions toggle (which we don't expose).
 */
export async function reorderGuildChannels(
  guildId: string,
  updates: { id: string; position?: number; parent_id?: string | null }[],
  reason?: string,
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  if (updates.length === 0) return { ok: true }
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    method: 'PATCH',
    headers: jsonHeaders(reason),
    body: JSON.stringify(updates),
  })
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

export async function setChannelPermissionOverwrite(
  channelId: string,
  overwriteId: string,
  body: { type: 0 | 1; allow: string; deny: string },
  reason?: string,
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(
    `${DISCORD_API}/channels/${channelId}/permissions/${overwriteId}`,
    { method: 'PUT', headers: jsonHeaders(reason), body: JSON.stringify(body) },
  )
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

export async function deleteChannelPermissionOverwrite(
  channelId: string,
  overwriteId: string,
  reason?: string,
): Promise<DiscordResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }
  const res = await fetch(
    `${DISCORD_API}/channels/${channelId}/permissions/${overwriteId}`,
    { method: 'DELETE', headers: authHeaders(reason) },
  )
  if (res.ok) return { ok: true }
  return { ok: false, error: await discordError(res) }
}

/**
 * Recreate a channel with the same settings and permission overwrites. Discord
 * doesn't have a native "duplicate" endpoint, so we re-POST from the source.
 * Messages and members are not copied.
 */
export async function duplicateGuildChannel(
  guildId: string,
  sourceId: string,
  reason?: string,
): Promise<{ ok: true; channel: DiscordChannel } | { ok: false; error: string }> {
  const source = await fetchChannel(sourceId)
  if (!source) return { ok: false, error: 'Could not load source channel.' }

  // Reuse fetchGuildChannels to compute a sensible position (just-below source).
  const created = await createGuildChannel(
    guildId,
    {
      name: `${source.name}-copy`.slice(0, 100),
      type: source.type as CreatableChannelType,
      parent_id: source.parent_id ?? null,
      topic: source.topic ?? null,
      nsfw: source.nsfw ?? false,
      rate_limit_per_user: source.rate_limit_per_user,
      bitrate: source.bitrate,
      user_limit: source.user_limit,
      position: source.position + 1,
    },
    reason,
  )
  if (!created.ok) return created

  // Best-effort copy of permission overwrites. We don't fail the duplicate if
  // a single overwrite fails — the user can fix it manually after.
  if (source.permission_overwrites?.length) {
    await Promise.all(
      source.permission_overwrites.map((ow) =>
        setChannelPermissionOverwrite(
          created.channel.id,
          ow.id,
          { type: ow.type, allow: ow.allow, deny: ow.deny },
          reason,
        ),
      ),
    )
  }

  return created
}
