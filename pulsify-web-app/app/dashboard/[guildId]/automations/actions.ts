'use server'

import { createClient } from '@/lib/supabase-server'
import { isBotInGuild, checkBotPermissions } from '@/lib/discord'
import { recordNotification } from '@/lib/notifications-server'

type EmbedConfig = {
  color: string
  title: string
  description: string
  fields: { name: string; value: string; inline: boolean }[]
  footer_text: string
  banner_color: string
}

export type PulseRulesConfig      = { enabled: boolean; channel_id: string; title: string; content: string }
export type PulseOnboardingConfig = { enabled: boolean; channel_id: string; title: string; content: string }
export type PulseChannelsConfig   = { enabled: boolean; structure: { category: string; channels: string[] }[] }

export type AutomationSettings = {
  welcome: {
    enabled:    boolean
    channel_id: string
    message:    string
    type?:      'message' | 'embed'
    embed?:     EmbedConfig
  }
  goodbye: {
    enabled:    boolean
    channel_id: string
    message:    string
    type?:      'message' | 'embed'
    embed?:     EmbedConfig
  }
  auto_role:         { enabled: boolean; role_id: string }
  moderation_alerts: { enabled: boolean; channel_id: string }
  // Pulse content — optional: when omitted, existing stored values are preserved.
  rules?:              PulseRulesConfig
  onboarding?:         PulseOnboardingConfig
  channels_reference?: PulseChannelsConfig
}

export type SaveResult = { ok: true } | { ok: false; error: string }

export async function saveAutomations(
  guildId: string,
  settings: AutomationSettings,
): Promise<SaveResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const isEmbed = settings.welcome.type === 'embed'
  const isGoodbyeEmbed = settings.goodbye.type === 'embed'

  if (settings.welcome.enabled && !settings.welcome.channel_id)
    return { ok: false, error: 'Welcome Message: please select a channel.' }
  if (settings.welcome.enabled && !isEmbed && !settings.welcome.message.trim())
    return { ok: false, error: 'Welcome Message: message text cannot be empty.' }
  if (settings.goodbye.enabled && !settings.goodbye.channel_id)
    return { ok: false, error: 'Goodbye Message: please select a channel.' }
  if (settings.goodbye.enabled && !isGoodbyeEmbed && !settings.goodbye.message.trim())
    return { ok: false, error: 'Goodbye Message: message text cannot be empty.' }
  if (settings.auto_role.enabled && !settings.auto_role.role_id)
    return { ok: false, error: 'Auto-Role: please select a role.' }
  if (settings.moderation_alerts.enabled && !settings.moderation_alerts.channel_id)
    return { ok: false, error: 'Moderation Alerts: please select a channel.' }

  const botPresent = await isBotInGuild(guildId)
  if (!botPresent)
    return { ok: false, error: 'The Pulse bot is not installed in this server. Add it first.' }

  const needsRoles = settings.auto_role.enabled
  const needsSend  = settings.welcome.enabled || settings.goodbye.enabled || settings.moderation_alerts.enabled

  if (needsRoles || needsSend) {
    const perms = await checkBotPermissions(guildId)
    // Treat null (couldn't verify) as a soft-pass — Discord will reject at runtime if the perm is missing.
    if (perms !== null) {
      if (!perms.inGuild)
        return { ok: false, error: 'Could not verify bot permissions. Is the bot still in the server?' }
      if (!perms.administrator) {
        if (needsRoles && !perms.manageRoles)
          return { ok: false, error: 'Auto-Role requires the bot to have the Manage Roles permission.' }
        if (needsSend && !perms.sendMessages)
          return { ok: false, error: 'Welcome Message / Moderation Alerts require the bot to have the Send Messages permission.' }
      }
    }
  }

  const { data: existing } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()

  const current = (existing?.settings as Record<string, unknown>) ?? {}
  const merged = {
    ...current,
    welcome: settings.welcome,
    goodbye: settings.goodbye,
    auto_role: settings.auto_role,
    moderation_alerts: settings.moderation_alerts,
    ...(settings.rules              !== undefined ? { rules: settings.rules } : {}),
    ...(settings.onboarding         !== undefined ? { onboarding: settings.onboarding } : {}),
    ...(settings.channels_reference !== undefined ? { channels_reference: settings.channels_reference } : {}),
  }

  const { error: dbError } = await supabase
    .from('guild_settings')
    .upsert(
      { guild_id: guildId, settings: merged, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )

  if (dbError) return { ok: false, error: `Failed to save: ${dbError.message}` }

  // Summarise which automations are currently active so the notification body
  // gives the reader a quick read on what just changed.
  const enabled: string[] = []
  if (settings.welcome.enabled) enabled.push('Welcome')
  if (settings.goodbye.enabled) enabled.push('Goodbye')
  if (settings.auto_role.enabled) enabled.push('Auto-Role')
  if (settings.moderation_alerts.enabled) enabled.push('Moderation Alerts')
  const automationClaims = user.user_metadata?.custom_claims as
    | { global_name?: string; username?: string }
    | undefined
  await recordNotification({
    guildId,
    type: 'automation_saved',
    title: 'Automations saved',
    body: enabled.length > 0 ? `Active: ${enabled.join(', ')}` : 'No automations are currently enabled.',
    link: `/dashboard/${guildId}/automations`,
    actorId: user.user_metadata?.provider_id ?? user.id,
    actorName: automationClaims?.global_name
      ?? automationClaims?.username
      ?? user.user_metadata?.full_name
      ?? null,
    actorUsername: automationClaims?.username ?? null,
  })
  return { ok: true }
}

export async function removePulseContent(
  guildId: string,
  type: 'rules' | 'onboarding' | 'channels_reference',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const { data: existing } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()

  const current = (existing?.settings as Record<string, unknown>) ?? {}
  const updated = {
    ...current,
    [type]: { ...(current[type] as Record<string, unknown> ?? {}), enabled: false },
  }

  const { error } = await supabase
    .from('guild_settings')
    .upsert({ guild_id: guildId, settings: updated, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
