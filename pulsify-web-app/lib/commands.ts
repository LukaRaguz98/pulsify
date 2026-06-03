// Command Center — the canonical catalog of Pulse slash commands plus the
// per-guild config shape, defaults and resolution helpers shared across the
// dashboard (page, content, edit panel, analytics).
//
// This catalog is the source of truth for *what commands exist* and their
// out-of-the-box behaviour. The bot mirrors it in `pulse-bot/src/commands.js`
// for registration + execution — keep the two in sync (same names, categories
// and default permissions). Per-server overrides live in the `command_configs`
// table; a missing row means "use the defaults below".

export type CommandCategory = 'utility' | 'information' | 'insights' | 'moderation'

/** Baseline access tier for a command, before role/channel allow+deny lists. */
export type CommandPermissionLevel = 'everyone' | 'moderator' | 'admin'

export type CommandOptionType = 'user' | 'string' | 'channel' | 'role' | 'boolean' | 'integer'

export type CommandOption = {
  name: string
  description: string
  type: CommandOptionType
  required?: boolean
}

export type CommandDefinition = {
  /** Slash name, lowercase, no leading slash. */
  name: string
  description: string
  category: CommandCategory
  defaultPermission: CommandPermissionLevel
  options?: CommandOption[]
  /**
   * Whether the reply is hidden to just the invoker (ephemeral) when no
   * per-guild override exists. Defaults to `true`; set `false` for commands
   * that should post publicly out of the box (e.g. /changelog).
   */
  defaultEphemeral?: boolean
  /** Example invocations rendered in the preview + copyable as quick tests. */
  examples: string[]
  /** Longer help text shown in the command preview. */
  detail: string
}

// ── Catalog ──────────────────────────────────────────────────────────────────
// A small, deliberately useful set. Everything here is OPT-IN per server via
// the Command Center — admins can disable, restrict or re-permission any of it.
export const COMMAND_CATALOG: CommandDefinition[] = [
  {
    name: 'help',
    description: 'List the commands available to you in this server',
    category: 'utility',
    defaultPermission: 'everyone',
    examples: ['/help'],
    detail:
      'Lists every command the member is allowed to run, grouped by category. Disabled and hidden commands are omitted automatically.',
  },
  {
    name: 'profile',
    description: "Show a member's profile — reputation, level and standing",
    category: 'information',
    defaultPermission: 'everyone',
    options: [
      { name: 'user', description: 'The member to look up (defaults to you)', type: 'user' },
    ],
    examples: ['/profile', '/profile user:@username'],
    detail:
      "A member's reputation and level shown as accent-tinted bars, plus account + join dates, their most significant roles, and quick links to their avatar and banner. Defaults to your own profile.",
  },
  {
    name: 'changelog',
    description: "Shows detailed release notes for a specific Pulsify version.",
    category: 'utility',
    defaultPermission: 'admin',
    defaultEphemeral: false,
    options: [
      {
        name: 'version',
        description: 'A version to look up.',
        type: 'string',
      },
    ],
    examples: ['/changelog', '/changelog version:0.30.0'],
    detail:
      'A polished summary of a Pulse release — the headline changes and highlights — with a link to the complete release notes. Defaults to the latest release; pass a version to view any past release. Admins only by default.',
  },
  {
    name: 'milestones',
    description: "Show a member's recognition milestones — earned and in progress",
    category: 'information',
    defaultPermission: 'everyone',
    options: [
      { name: 'user', description: 'The member to look up (defaults to you)', type: 'user' },
    ],
    examples: ['/milestones', '/milestones user:@username'],
    detail:
      'Lists the recognition milestones a member has earned (time in server, messages, voice, events, giveaways, XP/level) and how close they are to the next ones. Milestones are configured in the dashboard under Engagement › Milestones. Defaults to your own.',
  },
]

export const CATALOG_BY_NAME: Record<string, CommandDefinition> = Object.fromEntries(
  COMMAND_CATALOG.map((c) => [c.name, c]),
)

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

export const CATEGORY_META: Record<CommandCategory, { label: string; description: string }> = {
  utility: { label: 'Utility', description: 'Everyday helpers and the dashboard bridge.' },
  information: { label: 'Information', description: 'Look up servers and members.' },
  insights: { label: 'Insights', description: 'Activity summaries and analytics.' },
  moderation: { label: 'Moderation', description: 'Tools for keeping the server safe.' },
}

export const PERMISSION_META: Record<CommandPermissionLevel, { label: string; description: string }> =
  {
    everyone: { label: 'Everyone', description: 'Any member can run this command.' },
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
  { value: 'moderator', label: 'Moderators only' },
  { value: 'admin', label: 'Admins only' },
]
