// Server Statistics Channels — shared types, registry and rendering (PULSIFY-57).
//
// A statistics channel is a Discord channel whose NAME shows a live server
// statistic. The dashboard owns the config; the bot
// (pulse-bot/src/statistics-channels.js) provisions the channel and renames it.
// The value formatting + name rendering here is mirrored in that bot module so
// the dashboard preview matches exactly what Pulse posts — keep the two in sync.

export type ChannelKind = 'voice' | 'category'
export type UpdateMode = 'auto' | 'manual'
// everyone = members see the channel + value (voice: can't Connect).
// admins   = private (only staff/admins see it) — Discord shows a clean padlock.
export type Visibility = 'everyone' | 'admins'

export type StatType =
  | 'total_members' | 'humans' | 'bots' | 'online'
  | 'boosts' | 'boost_level'
  | 'roles' | 'channels' | 'voice_channels' | 'text_channels'
  | 'emojis' | 'stickers'
  | 'server_age'
  | 'new_today' | 'new_week'
  | 'total_messages' | 'active_members'

export type StatGroup = 'members' | 'server' | 'content' | 'activity'

export type StatMeta = {
  id: StatType
  label: string
  /** Alias token usable in a template in addition to {value}, e.g. {members}. */
  token: string
  emoji: string
  group: StatGroup
  /** Default channel-name template when the admin doesn't customise it. */
  defaultTemplate: string
  description: string
  /** Value is a formatted count (number) vs. an already-textual value (age). */
  kind: 'count' | 'text'
}

export const STAT_GROUPS: { id: StatGroup; label: string }[] = [
  { id: 'members', label: 'Members' },
  { id: 'server', label: 'Server' },
  { id: 'content', label: 'Content' },
  { id: 'activity', label: 'Activity' },
]

// The full catalogue of supported statistics. `token`/`emoji` power the default
// template; `defaultTemplate` is what a freshly-created channel starts with.
export const STAT_TYPES: StatMeta[] = [
  { id: 'total_members', label: 'Total Members', token: 'members', emoji: '👥', group: 'members', kind: 'count', defaultTemplate: '👥 Members: {members}', description: 'Everyone in the server, humans and bots.' },
  { id: 'humans', label: 'Human Members', token: 'humans', emoji: '🧑', group: 'members', kind: 'count', defaultTemplate: '🧑 Humans: {humans}', description: 'Members excluding bots.' },
  { id: 'bots', label: 'Bots', token: 'bots', emoji: '🤖', group: 'members', kind: 'count', defaultTemplate: '🤖 Bots: {bots}', description: 'Bot accounts in the server.' },
  { id: 'online', label: 'Online Members', token: 'online', emoji: '🟢', group: 'members', kind: 'count', defaultTemplate: '🟢 Online: {online}', description: 'Members currently online (approximate).' },

  { id: 'boosts', label: 'Server Boosts', token: 'boosts', emoji: '🚀', group: 'server', kind: 'count', defaultTemplate: '🚀 Boosts: {boosts}', description: 'Active Nitro boosts.' },
  { id: 'boost_level', label: 'Boost Level', token: 'level', emoji: '⭐', group: 'server', kind: 'count', defaultTemplate: '⭐ Boost Level: {level}', description: 'Server boost tier (0–3).' },
  { id: 'roles', label: 'Roles', token: 'roles', emoji: '🎭', group: 'server', kind: 'count', defaultTemplate: '🎭 Roles: {roles}', description: 'Number of roles.' },
  { id: 'channels', label: 'Channels', token: 'channels', emoji: '📁', group: 'server', kind: 'count', defaultTemplate: '📁 Channels: {channels}', description: 'All channels (excluding categories).' },
  { id: 'voice_channels', label: 'Voice Channels', token: 'voice', emoji: '🔊', group: 'server', kind: 'count', defaultTemplate: '🔊 Voice: {voice}', description: 'Voice + stage channels.' },
  { id: 'text_channels', label: 'Text Channels', token: 'text', emoji: '💬', group: 'server', kind: 'count', defaultTemplate: '💬 Text: {text}', description: 'Text, announcement + forum channels.' },
  { id: 'server_age', label: 'Server Age', token: 'age', emoji: '📅', group: 'server', kind: 'text', defaultTemplate: '📅 Age: {age}', description: 'How long the server has existed.' },

  { id: 'emojis', label: 'Emojis', token: 'emojis', emoji: '😀', group: 'content', kind: 'count', defaultTemplate: '😀 Emojis: {emojis}', description: 'Custom emojis.' },
  { id: 'stickers', label: 'Stickers', token: 'stickers', emoji: '🏷️', group: 'content', kind: 'count', defaultTemplate: '🏷️ Stickers: {stickers}', description: 'Custom stickers.' },

  { id: 'new_today', label: 'New Members Today', token: 'today', emoji: '📈', group: 'activity', kind: 'count', defaultTemplate: '📈 Joined Today: {today}', description: 'Members who joined in the last 24h.' },
  { id: 'new_week', label: 'New Members This Week', token: 'week', emoji: '📊', group: 'activity', kind: 'count', defaultTemplate: '📊 Joined This Week: {week}', description: 'Members who joined in the last 7 days.' },
  { id: 'total_messages', label: 'Total Messages', token: 'messages', emoji: '✉️', group: 'activity', kind: 'count', defaultTemplate: '✉️ Messages: {messages}', description: 'Messages Pulse has tracked in this server.' },
  { id: 'active_members', label: 'Active Members', token: 'active', emoji: '⚡', group: 'activity', kind: 'count', defaultTemplate: '⚡ Active: {active}', description: 'Members who messaged in the last 7 days.' },
]

const STAT_BY_ID = new Map(STAT_TYPES.map((s) => [s.id, s]))
export function statMeta(id: string): StatMeta | undefined {
  return STAT_BY_ID.get(id as StatType)
}
export function isStatType(id: string): id is StatType {
  return STAT_BY_ID.has(id as StatType)
}

export const STAT_LIMITS = {
  /** Discord allows 500 channels per guild; cap stat channels well below that. */
  maxChannels: 25,
  maxTemplate: 100,
} as const

export type StatChannel = {
  id: string
  guild_id: string
  channel_id: string | null
  channel_type: ChannelKind
  stat_type: StatType
  name_template: string
  category_id: string | null
  position: number
  enabled: boolean
  update_mode: UpdateMode
  visibility: Visibility
  last_value: string | null
  last_synced_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type StatChannelDraft = {
  stat_type: StatType
  channel_type: ChannelKind
  name_template: string
  category_id: string | null
  update_mode: UpdateMode
  visibility: Visibility
  enabled: boolean
}

export function normaliseStatChannel(row: Record<string, unknown>): StatChannel {
  const stat = (isStatType(String(row.stat_type)) ? row.stat_type : 'total_members') as StatType
  return {
    id: String(row.id),
    guild_id: String(row.guild_id),
    channel_id: (row.channel_id as string | null) ?? null,
    channel_type: row.channel_type === 'category' ? 'category' : 'voice',
    stat_type: stat,
    name_template: typeof row.name_template === 'string' && row.name_template ? row.name_template : (statMeta(stat)?.defaultTemplate ?? '{value}'),
    category_id: (row.category_id as string | null) ?? null,
    position: Number(row.position) || 0,
    enabled: row.enabled !== false,
    update_mode: row.update_mode === 'manual' ? 'manual' : 'auto',
    visibility: row.visibility === 'admins' ? 'admins' : 'everyone',
    last_value: (row.last_value as string | null) ?? null,
    last_synced_at: (row.last_synced_at as string | null) ?? null,
    last_error: (row.last_error as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

/** Format a raw statistic value for display. `count` stats get thousands
 *  separators; `text` stats (server age) are passed through as-is. Mirrored in
 *  the bot's statistics-channels.js — keep in sync. */
export function formatStatValue(statType: string, raw: number | string | null | undefined): string {
  if (raw === null || raw === undefined) return '—'
  const meta = statMeta(statType)
  if (meta?.kind === 'text') return String(raw)
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return String(raw)
  return n.toLocaleString('en-US')
}

/** Render a channel name from a template + formatted value. Replaces both the
 *  universal {value} token and the stat's alias token (e.g. {members}), then
 *  clamps to Discord's 100-char channel-name limit. Mirrored in the bot. */
export function renderStatName(template: string, statType: string, formattedValue: string): string {
  const meta = statMeta(statType)
  let out = template && template.trim() ? template : (meta?.defaultTemplate ?? '{value}')
  out = out.replace(/\{value\}/gi, formattedValue)
  if (meta) out = out.replace(new RegExp(`\\{${meta.token}\\}`, 'gi'), formattedValue)
  return out.slice(0, STAT_LIMITS.maxTemplate)
}

/** Format a server's age from its creation date (mirrored in the bot). */
export function formatServerAge(createdAtMs: number, now = Date.now()): string {
  const days = Math.max(0, Math.floor((now - createdAtMs) / 86_400_000))
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  if (years > 0) return months > 0 ? `${years}y ${months}mo` : `${years}y`
  if (months > 0) {
    const rem = days % 30
    return rem > 0 ? `${months}mo ${rem}d` : `${months}mo`
  }
  return `${days}d`
}

/** Validate a draft before it hits the API. Returns an error string or null. */
export function validateStatChannelDraft(draft: Partial<StatChannelDraft>): string | null {
  if (!draft.stat_type || !isStatType(draft.stat_type)) return 'Pick a statistic to track.'
  if (draft.channel_type && draft.channel_type !== 'voice' && draft.channel_type !== 'category') {
    return 'Invalid channel type.'
  }
  const template = (draft.name_template ?? '').trim()
  if (!template) return 'The channel name template cannot be empty.'
  if (template.length > STAT_LIMITS.maxTemplate) {
    return `The template must be ${STAT_LIMITS.maxTemplate} characters or fewer.`
  }
  // Require at least one value placeholder so the number actually shows.
  const meta = statMeta(draft.stat_type)
  const hasValue = /\{value\}/i.test(template) || (meta && new RegExp(`\\{${meta.token}\\}`, 'i').test(template))
  if (!hasValue) return `Include {value}${meta ? ` or {${meta.token}}` : ''} in the template so the number appears.`
  return null
}
