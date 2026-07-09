'use server'

import { createClient } from '@/lib/supabase-server'
import { isBotInGuild, checkBotPermissions } from '@/lib/discord'

// Auto-Role — automatically grant a role to new members on join. The config
// lives in `guild_settings.settings.auto_role` (unchanged) so the Pulse bot
// keeps reading it exactly as before; only the dashboard home for it moved from
// Automations into Server › Roles › Self-Assign Roles.
export type AutoRoleConfig = { enabled: boolean; role_id: string }

export async function getAutoRole(guildId: string): Promise<AutoRoleConfig> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { enabled: false, role_id: '' }

  const { data } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()

  const ar = (data?.settings as Record<string, unknown> | null)?.auto_role as
    | Partial<AutoRoleConfig>
    | undefined
  return { enabled: ar?.enabled ?? false, role_id: ar?.role_id ?? '' }
}

export async function saveAutoRole(
  guildId: string,
  config: AutoRoleConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  if (config.enabled && !config.role_id) return { ok: false, error: 'Please select a role to assign.' }

  const botPresent = await isBotInGuild(guildId)
  if (!botPresent)
    return { ok: false, error: 'The Pulse bot is not installed in this server. Add it first.' }

  if (config.enabled) {
    const perms = await checkBotPermissions(guildId)
    // Treat null (couldn't verify) as a soft-pass — Discord rejects at runtime
    // if the permission is actually missing.
    if (perms !== null) {
      if (!perms.inGuild)
        return { ok: false, error: 'Could not verify bot permissions. Is the bot still in the server?' }
      if (!perms.administrator && !perms.manageRoles)
        return { ok: false, error: 'Auto-Role requires the bot to have the Manage Roles permission.' }
    }
  }

  const { data: existing } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()

  const current = (existing?.settings as Record<string, unknown>) ?? {}
  const merged = { ...current, auto_role: { enabled: config.enabled, role_id: config.role_id } }

  const { error } = await supabase
    .from('guild_settings')
    .upsert(
      { guild_id: guildId, settings: merged, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )

  if (error) return { ok: false, error: `Failed to save: ${error.message}` }
  return { ok: true }
}
