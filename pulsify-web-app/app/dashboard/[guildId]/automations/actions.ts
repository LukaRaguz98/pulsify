'use server'

import { createClient } from '@/lib/supabase-server'
import { isBotInGuild, checkBotPermissions } from '@/lib/discord'

export type AutomationSettings = {
  welcome:             { enabled: boolean; channel_id: string; message: string }
  auto_role:           { enabled: boolean; role_id: string }
  moderation_alerts:   { enabled: boolean; channel_id: string }
}

export type SaveResult = { ok: true } | { ok: false; error: string }

export async function saveAutomations(
  guildId: string,
  settings: AutomationSettings,
): Promise<SaveResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  // Client-side already validates, but re-check here for safety
  if (settings.welcome.enabled && !settings.welcome.channel_id)
    return { ok: false, error: 'Welcome Message: please select a channel.' }
  if (settings.welcome.enabled && !settings.welcome.message.trim())
    return { ok: false, error: 'Welcome Message: message text cannot be empty.' }
  if (settings.auto_role.enabled && !settings.auto_role.role_id)
    return { ok: false, error: 'Auto-Role: please select a role.' }
  if (settings.moderation_alerts.enabled && !settings.moderation_alerts.channel_id)
    return { ok: false, error: 'Moderation Alerts: please select a channel.' }

  // Verify bot is installed
  const botPresent = await isBotInGuild(guildId)
  if (!botPresent)
    return { ok: false, error: 'The Pulse bot is not installed in this server. Add it first.' }

  // Check permissions only for features that are enabled
  const needsRoles   = settings.auto_role.enabled
  const needsSend    = settings.welcome.enabled || settings.moderation_alerts.enabled
  const needsBan     = false // unban handled separately

  if (needsRoles || needsSend || needsBan) {
    const perms = await checkBotPermissions(guildId)
    if (!perms.inGuild)
      return { ok: false, error: 'Could not verify bot permissions. Is the bot still in the server?' }
    if (needsRoles && !perms.manageRoles)
      return { ok: false, error: 'Auto-Role requires the bot to have the Manage Roles permission.' }
    if (needsSend && !perms.sendMessages)
      return { ok: false, error: 'Welcome Message / Moderation Alerts require the bot to have the Send Messages permission.' }
  }

  const { error: dbError } = await supabase
    .from('guild_settings')
    .upsert(
      { guild_id: guildId, settings, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )

  if (dbError) return { ok: false, error: `Failed to save: ${dbError.message}` }
  return { ok: true }
}
