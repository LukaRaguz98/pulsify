'use server'

import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import {
  CATALOG_BY_NAME,
  defaultConfig,
  normaliseConfig,
  commandStatus,
  type CommandConfig,
} from '@/lib/commands'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

/** Persist a command's full config row for this guild. */
export async function saveCommandConfig(
  guildId: string,
  commandName: string,
  config: CommandConfig,
): Promise<ActionResult> {
  const def = CATALOG_BY_NAME[commandName]
  if (!def) return { ok: false, error: 'Unknown command.' }

  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const normalised = normaliseConfig(config)
  const supabase = await createClient()
  const { error } = await supabase.from('command_configs').upsert(
    {
      guild_id: guildId,
      command_name: commandName,
      ...normalised,
      updated_by: auth.moderator.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'guild_id,command_name' },
  )
  if (error) return { ok: false, error: `Failed to save command: ${error.message}` }

  const status = commandStatus(normalised)
  await recordNotification({
    guildId,
    type: 'server_settings_changed',
    severity: 'info',
    title: `Command /${commandName} ${status === 'enabled' ? 'updated' : status}`,
    body:
      status === 'maintenance'
        ? `/${commandName} is in maintenance and paused for everyone.`
        : status === 'disabled'
          ? `/${commandName} was disabled in this server.`
          : `Settings for /${commandName} were updated.`,
    link: `/dashboard/${guildId}/commands`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    metadata: { command: commandName },
  })

  return { ok: true }
}

/**
 * Flip the enabled flag on many commands at once (used by the list-level
 * "enable/disable all" affordance). Loads each command's current config so the
 * other settings survive the toggle, then upserts the merged rows.
 */
export async function bulkSetCommandsEnabled(
  guildId: string,
  commandNames: string[],
  enabled: boolean,
): Promise<ActionResult<{ updated: number }>> {
  const names = commandNames.filter((n) => CATALOG_BY_NAME[n])
  if (names.length === 0) return { ok: false, error: 'No valid commands selected.' }

  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('command_configs')
    .select('*')
    .eq('guild_id', guildId)
    .in('command_name', names)

  const byName = new Map<string, Partial<CommandConfig>>(
    (existing ?? []).map((row) => [row.command_name as string, row as Partial<CommandConfig>]),
  )

  const now = new Date().toISOString()
  const rows = names.map((name) => ({
    guild_id: guildId,
    command_name: name,
    ...normaliseConfig({ ...defaultConfig(), ...byName.get(name), enabled }),
    updated_by: auth.moderator.userId,
    updated_at: now,
  }))

  const { error } = await supabase
    .from('command_configs')
    .upsert(rows, { onConflict: 'guild_id,command_name' })
  if (error) return { ok: false, error: `Failed to update commands: ${error.message}` }

  await recordNotification({
    guildId,
    type: 'server_settings_changed',
    severity: 'info',
    title: `${names.length} command${names.length === 1 ? '' : 's'} ${enabled ? 'enabled' : 'disabled'}`,
    body: `${enabled ? 'Enabled' : 'Disabled'}: ${names.map((n) => `/${n}`).join(', ')}`,
    link: `/dashboard/${guildId}/commands`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
  })

  return { ok: true, data: { updated: rows.length } }
}
