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
}

export type DiscordChannel = {
  id: string
  name: string
  type: number
  position: number
  parent_id: string | null
  topic: string | null
}

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
    avatar: string | null
    discriminator: string
  }
}

export type DiscordMember = {
  user: {
    id: string
    username: string
    avatar: string | null
    global_name: string | null
  }
  nick: string | null
  roles: string[]
  joined_at: string
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

export async function fetchUserGuilds(accessToken: string): Promise<DiscordGuild[]> {
  const res = await fetch(`${DISCORD_API}/users/@me/guilds?with_counts=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    next: { revalidate: 30 },
  })
  if (!res.ok) return []
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
  manageRoles: boolean
  sendMessages: boolean
  banMembers: boolean
}

export async function checkBotPermissions(guildId: string): Promise<BotPermissions> {
  const none: BotPermissions = { inGuild: false, manageRoles: false, sendMessages: false, banMembers: false }
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID) return none

  const botId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID
  const [memberRes, roles] = await Promise.all([
    fetch(`${DISCORD_API}/guilds/${guildId}/members/${botId}`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      cache: 'no-store',
    }),
    fetchGuildRoles(guildId),
  ])

  if (!memberRes.ok) return none
  const member: { roles: string[] } = await memberRes.json()
  const botRoleIds = new Set(member.roles)

  let permissions = BigInt(0)
  for (const role of roles) {
    // include @everyone role (same id as guild) and bot's assigned roles
    if (role.id === guildId || botRoleIds.has(role.id)) {
      permissions |= BigInt(role.permissions)
    }
  }

  const ADMINISTRATOR = BigInt(0x8)
  if ((permissions & ADMINISTRATOR) !== BigInt(0)) {
    return { inGuild: true, manageRoles: true, sendMessages: true, banMembers: true }
  }

  return {
    inGuild: true,
    manageRoles:   (permissions & BigInt(0x10000000)) !== BigInt(0),
    sendMessages:  (permissions & BigInt(0x800))      !== BigInt(0),
    banMembers:    (permissions & BigInt(0x4))         !== BigInt(0),
  }
}

export async function unbanUser(
  guildId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/bans/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
  })

  // 204 No Content = success
  if (res.ok) return { ok: true }

  const body = await res.json().catch(() => ({})) as { message?: string }
  return { ok: false, error: body.message ?? `Discord API error ${res.status}` }
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

export async function postChannelEmbed(
  channelId: string,
  embed: { color: number; title: string; description: string },
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

export async function createGuildChannel(
  guildId: string,
  params: { name: string; type: 0 | 4; parent_id?: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, error: 'Bot token not configured.' }

  const name = params.type === 4
    ? params.name.slice(0, 100)
    : params.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 100) || 'channel'

  const body: Record<string, unknown> = { name, type: params.type }
  if (params.parent_id) body.parent_id = params.parent_id

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (res.ok) {
    const data = await res.json() as { id: string }
    return { ok: true, id: data.id }
  }
  const err = await res.json().catch(() => ({})) as { message?: string }
  return { ok: false, error: err.message ?? `Discord API error ${res.status}` }
}
