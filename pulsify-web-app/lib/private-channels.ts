// Private Channels — config types + pure helpers (PULSIFY-50).
//
// No JSX / framework / IO imports here (same discipline as lib/tickets.ts):
// trivially testable, and mirrored in plain JS by pulse-bot/src/private-channels.js.
// The dashboard (config save + active-channel management) and the bot both
// read/write `private_channel_configs` / `private_channels`, so the defaults,
// name-formatting and validation rules MUST agree between the two.

export type PrivateChannelType = 'voice'

export type PrivateChannelConfig = {
  enabled: boolean
  category_name: string
  trigger_name: string
  name_format: string
  channel_type: PrivateChannelType
  user_limit: number
  default_locked: boolean
  auto_delete: boolean
  auto_delete_delay: number
  allowed_role_ids: string[]
  ignored_role_ids: string[]
  per_user_limit: number
  allow_owner_management: boolean
  // Read-only on the dashboard — Pulse writes these when it provisions Discord.
  category_id?: string | null
  trigger_channel_id?: string | null
}

export const DEFAULT_PRIVATE_CHANNEL_CONFIG: PrivateChannelConfig = {
  enabled: false,
  category_name: 'Private Channels',
  trigger_name: 'Create Channel',
  name_format: "{display}'s Channel",
  channel_type: 'voice',
  user_limit: 0,
  default_locked: false,
  auto_delete: true,
  auto_delete_delay: 60,
  allowed_role_ids: [],
  ignored_role_ids: [],
  per_user_limit: 1,
  allow_owner_management: true,
}

// Bounds shared by the dashboard validator and the bot (Discord caps voice user
// limits at 99; an empty channel sweep faster than ~10s risks racing the join).
export const PRIVATE_CHANNEL_LIMITS = {
  nameMax: 100,
  userLimitMax: 99,
  autoDeleteDelayMin: 10,
  autoDeleteDelayMax: 3600,
  perUserMax: 25,
} as const

// Custom_id prefix for the in-channel owner control panel (mirrored in the bot).
//   pc:<action>:<channelId>   e.g. pc:lock:123, pc:rename:123
export const PC = 'pc'

export const NAME_FORMAT_TOKENS = ['{username}', '{display}'] as const

/**
 * Resolve a private-channel name from the template. Unlike ticket channels,
 * voice channels keep spaces and mixed case, so we only trim + cap length
 * (Discord rejects names over 100 chars). Falls back to the owner's name.
 */
export function formatPrivateChannelName(
  format: string,
  ctx: { username: string; display?: string },
): string {
  const display = ctx.display || ctx.username || 'Member'
  const raw = String(format || DEFAULT_PRIVATE_CHANNEL_CONFIG.name_format)
    .replace(/\{username\}/g, ctx.username || 'member')
    .replace(/\{display\}/g, display)
    .trim()
  return (raw || `${display}'s Channel`).slice(0, PRIVATE_CHANNEL_LIMITS.nameMax)
}

/** Coerce a raw DB row (or partial input) into a fully-defaulted config. */
export function normalisePrivateChannelConfig(
  row: Partial<PrivateChannelConfig> | null | undefined,
): PrivateChannelConfig {
  const d = DEFAULT_PRIVATE_CHANNEL_CONFIG
  const r = row ?? {}
  return {
    enabled: Boolean(r.enabled),
    category_name: (r.category_name || d.category_name).slice(0, PRIVATE_CHANNEL_LIMITS.nameMax),
    trigger_name: (r.trigger_name || d.trigger_name).slice(0, PRIVATE_CHANNEL_LIMITS.nameMax),
    name_format: (r.name_format || d.name_format).slice(0, PRIVATE_CHANNEL_LIMITS.nameMax),
    channel_type: 'voice',
    user_limit: clampInt(r.user_limit, 0, PRIVATE_CHANNEL_LIMITS.userLimitMax, d.user_limit),
    default_locked: Boolean(r.default_locked ?? d.default_locked),
    auto_delete: Boolean(r.auto_delete ?? d.auto_delete),
    auto_delete_delay: clampInt(
      r.auto_delete_delay,
      PRIVATE_CHANNEL_LIMITS.autoDeleteDelayMin,
      PRIVATE_CHANNEL_LIMITS.autoDeleteDelayMax,
      d.auto_delete_delay,
    ),
    allowed_role_ids: Array.isArray(r.allowed_role_ids) ? r.allowed_role_ids.map(String) : [],
    ignored_role_ids: Array.isArray(r.ignored_role_ids) ? r.ignored_role_ids.map(String) : [],
    per_user_limit: clampInt(r.per_user_limit, 0, PRIVATE_CHANNEL_LIMITS.perUserMax, d.per_user_limit),
    allow_owner_management: Boolean(r.allow_owner_management ?? d.allow_owner_management),
    category_id: r.category_id ?? null,
    trigger_channel_id: r.trigger_channel_id ?? null,
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * Validate a config the way the save action expects. Returns an error string
 * (human-readable, prefixed "Private Channels:") or null when valid. Only
 * meaningful when `enabled` — a disabled config skips every content check.
 */
export function validatePrivateChannelConfig(c: PrivateChannelConfig): string | null {
  if (!c.enabled) return null
  if (!c.category_name.trim()) return 'Private Channels: enter a category name.'
  if (!c.trigger_name.trim()) return 'Private Channels: enter a trigger channel name.'
  if (!c.name_format.trim()) return 'Private Channels: enter a channel name format.'
  if (c.user_limit < 0 || c.user_limit > PRIVATE_CHANNEL_LIMITS.userLimitMax)
    return `Private Channels: user limit must be between 0 and ${PRIVATE_CHANNEL_LIMITS.userLimitMax}.`
  if (
    c.auto_delete &&
    (c.auto_delete_delay < PRIVATE_CHANNEL_LIMITS.autoDeleteDelayMin ||
      c.auto_delete_delay > PRIVATE_CHANNEL_LIMITS.autoDeleteDelayMax)
  )
    return `Private Channels: auto-delete delay must be between ${PRIVATE_CHANNEL_LIMITS.autoDeleteDelayMin} and ${PRIVATE_CHANNEL_LIMITS.autoDeleteDelayMax} seconds.`
  return null
}
