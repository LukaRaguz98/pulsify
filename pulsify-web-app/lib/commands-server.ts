import 'server-only'
import { createClient } from '@/lib/supabase-server'
import type {
  CommandCategory,
  CommandDefinition,
  CommandOption,
  CommandPermissionLevel,
  CommandPlan,
} from '@/lib/commands'

// Server-side read of the slash-command catalog (PULSIFY-61).
//
// The bot owns the catalog and upserts it into `command_catalog` on every
// startup (see pulse-bot/src/catalog-sync.js). This reads it back for the
// Command Center. Server-only because it's a DB read — the page fetches once
// and passes the result down to the client components as props.
//
// WHY THERE IS NO STATIC FALLBACK
// The obvious "safe" move is to keep a hardcoded catalog here for when the
// table is empty. That's precisely what we just deleted: a second copy of the
// list with nothing keeping it honest, which had already drifted five commands
// out of sync. A fallback would reintroduce it, and worse, it would only ever
// be visible in the rare case nobody tests — so its drift would go unnoticed.
//
// An empty table means the bot has never booted against this database. In that
// state the guild genuinely has no commands registered, so listing any would be
// a lie. The Command Center shows an empty state instead, which is both honest
// and self-explanatory ("start Pulse and its commands appear here").

/** Shape of a `command_catalog` row. */
type CatalogRow = {
  command_name: string
  description: string | null
  category: string | null
  module: string | null
  default_permission: string | null
  default_ephemeral: boolean | null
  min_plan: string | null
  options: unknown
  examples: string[] | null
  detail: string | null
}

const CATEGORIES: CommandCategory[] = ['utility', 'information', 'insights', 'moderation']
const PERMISSIONS: CommandPermissionLevel[] = ['everyone', 'support', 'moderator', 'admin']
const PLANS: CommandPlan[] = ['free', 'pro', 'business', 'enterprise']

/**
 * Defensive normalisation. The bot writes these rows, so in practice they're
 * well-formed — but an older bot build syncing a category or tier this
 * dashboard doesn't know about must degrade to a safe default rather than
 * render `undefined` or crash the page. Same stance as
 * billing-server.getSubscriptionRow.
 */
function normaliseRow(row: CatalogRow): CommandDefinition {
  const category = CATEGORIES.includes(row.category as CommandCategory)
    ? (row.category as CommandCategory)
    : 'utility'
  // An unknown permission tier falls back to the MOST restrictive, not the
  // least: if we can't tell who may run a command, don't imply it's open to
  // everyone.
  const defaultPermission = PERMISSIONS.includes(row.default_permission as CommandPermissionLevel)
    ? (row.default_permission as CommandPermissionLevel)
    : 'admin'
  const minPlan = PLANS.includes(row.min_plan as CommandPlan)
    ? (row.min_plan as CommandPlan)
    : 'free'

  return {
    name: row.command_name,
    description: row.description ?? '',
    category,
    module: row.module ?? null,
    defaultPermission,
    defaultEphemeral: row.default_ephemeral ?? true,
    minPlan,
    options: Array.isArray(row.options) ? (row.options as CommandOption[]) : [],
    examples: row.examples ?? [],
    detail: row.detail ?? '',
  }
}

/**
 * The catalog as last published by the bot, ordered for display: grouped by
 * category, alphabetical within it. Returns [] when the bot has never synced —
 * callers render an empty state (see above).
 */
export async function getCommandCatalog(): Promise<CommandDefinition[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('command_catalog')
    .select('*')
    .order('category', { ascending: true })
    .order('command_name', { ascending: true })

  if (error) {
    console.warn('[Pulsify] command_catalog read failed:', error.message)
    return []
  }
  return (data ?? []).map((row) => normaliseRow(row as CatalogRow))
}

/**
 * One command by name, or null if this build of the bot doesn't define it.
 * Callers use this to validate a command name before writing a
 * `command_configs` row — without it, any string could be persisted as a
 * command and would linger in the table forever.
 */
export async function getCommandDefinition(
  name: string,
): Promise<CommandDefinition | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('command_catalog')
    .select('*')
    .eq('command_name', name)
    .maybeSingle<CatalogRow>()
  if (error || !data) return null
  return normaliseRow(data)
}

/** The subset of `names` the bot actually defines, preserving order. */
export async function filterKnownCommands(names: string[]): Promise<string[]> {
  if (names.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('command_catalog')
    .select('command_name')
    .in('command_name', names)
  if (error) return []
  const known = new Set((data ?? []).map((r) => (r as { command_name: string }).command_name))
  return names.filter((n) => known.has(n))
}

/** When the bot last published its catalog, or null if it never has. */
export async function getCatalogSyncedAt(): Promise<Date | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('command_catalog')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ synced_at: string }>()
  return data?.synced_at ? new Date(data.synced_at) : null
}
