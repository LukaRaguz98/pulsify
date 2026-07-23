// Command Center — the shared types, per-guild config shape, defaults and
// resolution helpers used across the dashboard (page, content, edit panel,
// analytics).
//
// ── Where the catalog lives (PULSIFY-61) ─────────────────────────────────────
// It is NOT in this file any more. The bot (`pulse-bot/src/commands.js`) owns
// the catalog and syncs it into the `command_catalog` table on startup; the
// dashboard reads that table via `lib/commands-server.ts`.
//
// This file used to carry a hand-mirrored copy of the bot's catalog, and the two
// drifted — the copy here silently lost /invites, /invite-leaderboard,
// /invite-rewards, /daily and /weekly, so the Command Center couldn't configure
// five commands the bot was serving. A duplicated list with no mechanism to keep
// it honest will always drift, so the duplicate is gone rather than repaired.
// Adding a command is now a change to the bot's catalog only.
//
// Per-server overrides live in `command_configs`; a missing row means "use the
// synced defaults".

export type CommandCategory = 'utility' | 'information' | 'insights' | 'moderation'

/**
 * Baseline access tier for a command, before role/channel allow+deny lists.
 * Mirrors the ladder in `pulse-bot/src/permissions.js`, where 'everyone' is the
 * stored alias for its `member` tier. 'support' means the guild's configured
 * ticket support roles.
 */
export type CommandPermissionLevel = 'everyone' | 'support' | 'moderator' | 'admin'

export type CommandOptionType =
  | 'user'
  | 'string'
  | 'channel'
  | 'role'
  | 'boolean'
  | 'integer'
  | 'number'
  | 'mentionable'
  | 'attachment'
  /** A subcommand container, e.g. the `set` in `/birthday set`. */
  | 'subcommand'

export type CommandOption = {
  /**
   * Qualified name. For a subcommand's own options this reads "set month",
   * matching how the member types it.
   */
  name: string
  description: string
  type: CommandOptionType
  required?: boolean
}

/** Plan slugs from lib/billing.ts. */
export type CommandPlan = 'free' | 'pro' | 'business' | 'enterprise'

export type CommandDefinition = {
  /** Slash name, lowercase, no leading slash. */
  name: string
  description: string
  category: CommandCategory
  /**
   * The Pulsify feature this command belongs to (a key of MODULE_SOURCES in
   * `pulse-bot/src/feature-gate.js`). The command is unavailable in servers that
   * have the feature switched off. `null` = always available.
   */
  module: string | null
  defaultPermission: CommandPermissionLevel
  options?: CommandOption[]
  /**
   * Whether the reply is hidden to just the invoker (ephemeral) when no
   * per-guild override exists. Defaults to `true`; set `false` for commands
   * that should post publicly out of the box (e.g. /changelog).
   */
  defaultEphemeral?: boolean
  /** Minimum plan. 'free' = ungated. Enforced against the guild owner's plan. */
  minPlan: CommandPlan
  /** Example invocations rendered in the preview + copyable as quick tests. */
  examples: string[]
  /** Longer help text shown in the command preview. */
  detail: string
}

// ── Catalog ──────────────────────────────────────────────────────────────────
// The catalog itself is fetched from the `command_catalog` table — see
// `lib/commands-server.ts`, which the Command Center page calls and passes down
// as props. There is deliberately NO static copy here: that copy is what drifted
// out of sync with the bot.

/** Index a fetched catalog by name for O(1) lookups in the UI. */
export function catalogByName(
  catalog: CommandDefinition[],
): Record<string, CommandDefinition> {
  return Object.fromEntries(catalog.map((c) => [c.name, c]))
}

// ── Per-guild config ──────────────────────────────────────────────────────────

export type ConfigPermissionLevel = 'inherit' | CommandPermissionLevel

/** Mirror of a `command_configs` row, minus the keys (guild_id/command_name). */
export type CommandConfig = {
  enabled: boolean
  hidden: boolean
  /** null = inherit the catalog category. */
  category: CommandCategory | null
  permission_level: ConfigPermissionLevel
  allowed_role_ids: string[]
  denied_role_ids: string[]
  allowed_channel_ids: string[]
  denied_channel_ids: string[]
  cooldown_seconds: number
  usage_limit_per_day: number
  maintenance: boolean
  /** true = reply visible only to the invoker (ephemeral); false = public. */
  ephemeral: boolean
}

export function defaultConfig(): CommandConfig {
  return {
    enabled: true,
    hidden: false,
    category: null,
    permission_level: 'inherit',
    allowed_role_ids: [],
    denied_role_ids: [],
    allowed_channel_ids: [],
    denied_channel_ids: [],
    cooldown_seconds: 0,
    usage_limit_per_day: 0,
    maintenance: false,
    ephemeral: true,
  }
}

/**
 * The out-of-the-box config for a specific command — `defaultConfig()` plus any
 * catalog-level overrides (currently just `defaultEphemeral`). Use this instead
 * of `defaultConfig()` whenever you have the command definition so per-command
 * defaults (e.g. /changelog being public) are respected before an admin saves
 * an override.
 */
export function defaultConfigFor(def: CommandDefinition): CommandConfig {
  return { ...defaultConfig(), ephemeral: def.defaultEphemeral ?? defaultConfig().ephemeral }
}

const VALID_CATEGORIES: CommandCategory[] = ['utility', 'information', 'insights', 'moderation']
const VALID_LEVELS: ConfigPermissionLevel[] = ['inherit', 'everyone', 'moderator', 'admin']

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, 50)
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

/** Coerce an untrusted row/draft into a safe CommandConfig (clamps + defaults). */
export function normaliseConfig(raw: Partial<CommandConfig> | null | undefined): CommandConfig {
  const base = defaultConfig()
  if (!raw) return base
  const category =
    raw.category && VALID_CATEGORIES.includes(raw.category) ? raw.category : null
  const level =
    raw.permission_level && VALID_LEVELS.includes(raw.permission_level)
      ? raw.permission_level
      : 'inherit'
  return {
    enabled: raw.enabled ?? base.enabled,
    hidden: raw.hidden ?? base.hidden,
    category,
    permission_level: level,
    allowed_role_ids: ids(raw.allowed_role_ids),
    denied_role_ids: ids(raw.denied_role_ids),
    allowed_channel_ids: ids(raw.allowed_channel_ids),
    denied_channel_ids: ids(raw.denied_channel_ids),
    cooldown_seconds: clampInt(raw.cooldown_seconds ?? 0, 0, 86_400),
    usage_limit_per_day: clampInt(raw.usage_limit_per_day ?? 0, 0, 100_000),
    maintenance: raw.maintenance ?? base.maintenance,
    ephemeral: raw.ephemeral ?? base.ephemeral,
  }
}

// ── Resolution helpers ──────────────────────────────────────────────────────

export function effectiveCategory(def: CommandDefinition, config: CommandConfig): CommandCategory {
  return config.category ?? def.category
}

export function effectivePermission(
  def: CommandDefinition,
  config: CommandConfig,
): CommandPermissionLevel {
  return config.permission_level === 'inherit' ? def.defaultPermission : config.permission_level
}

/** A command is "restricted" if any allow/deny list narrows who can run it. */
export function hasRestrictions(config: CommandConfig): boolean {
  return (
    config.allowed_role_ids.length > 0 ||
    config.denied_role_ids.length > 0 ||
    config.allowed_channel_ids.length > 0 ||
    config.denied_channel_ids.length > 0
  )
}

export type CommandStatus = 'enabled' | 'disabled' | 'maintenance'

export function commandStatus(config: CommandConfig): CommandStatus {
  if (config.maintenance) return 'maintenance'
  return config.enabled ? 'enabled' : 'disabled'
}

// ── Display metadata ─────────────────────────────────────────────────────────

/**
 * Member-facing names for the modules a command can belong to. MIRRORS the
 * `label` fields of MODULE_SOURCES in `pulse-bot/src/feature-gate.js` — the bot
 * syncs the module KEY, not its label, so the two must agree. An unknown key
 * (an older dashboard against a newer bot) falls back to the raw key rather
 * than rendering blank.
 *
 * Note this is a superset of FEATURE_KEYS in lib/templates.ts: templates can
 * only flip nine features, but Birthdays and Invites also own master switches
 * that gate their commands.
 */
export const MODULE_LABELS: Record<string, string> = {
  automations: 'Automations',
  onboarding: 'Onboarding & Welcome',
  moderation_alerts: 'Moderation Alerts',
  pulse_guard: 'Pulse Guard',
  ddos_protection: 'DDoS Protection',
  tickets: 'Tickets',
  private_channels: 'Private Channels',
  leveling: 'Levels & XP',
  economy: 'Economy',
  birthdays: 'Birthdays',
  invites: 'Invite Tracking',
}

export const CATEGORY_META: Record<CommandCategory, { label: string; description: string }> = {
  utility: { label: 'Utility', description: 'Everyday helpers and the dashboard bridge.' },
  information: { label: 'Information', description: 'Look up servers and members.' },
  insights: { label: 'Insights', description: 'Activity summaries and analytics.' },
  moderation: { label: 'Moderation', description: 'Tools for keeping the server safe.' },
}

export const PERMISSION_META: Record<CommandPermissionLevel, { label: string; description: string }> =
  {
    everyone: { label: 'Everyone', description: 'Any member can run this command.' },
    support: {
      label: 'Support staff',
      description:
        'Requires one of the support roles set under Server › Tickets — plus moderators and admins.',
    },
    moderator: {
      label: 'Moderators',
      description: 'Requires Manage Messages, Kick, Ban, Timeout, or Manage Server.',
    },
    admin: {
      label: 'Admins',
      description: 'Requires Manage Server or Administrator.',
    },
  }

export const PERMISSION_LEVEL_OPTIONS: { value: ConfigPermissionLevel; label: string }[] = [
  { value: 'inherit', label: 'Default for command' },
  { value: 'everyone', label: 'Everyone' },
  { value: 'support', label: 'Support staff only' },
  { value: 'moderator', label: 'Moderators only' },
  { value: 'admin', label: 'Admins only' },
]
