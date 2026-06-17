'use server'

import { createClient } from '@/lib/supabase-server'
import { isBotInGuild, checkBotPermissions, deleteChannel, modifyChannel } from '@/lib/discord'
import { recordNotification } from '@/lib/notifications-server'
import {
  type PrivateChannelConfig,
  PRIVATE_CHANNEL_LIMITS,
  normalisePrivateChannelConfig,
  validatePrivateChannelConfig,
} from '@/lib/private-channels'

export type ActionResult = { ok: true } | { ok: false; error: string }

// Discord channel type for a guild voice channel (modifyChannel needs it).
const VOICE_CHANNEL_TYPE = 2

/**
 * Persist the Private Channels config for a guild. Validates, checks the bot can
 * create channels when enabling, and upserts `private_channel_configs` while
 * PRESERVING the Pulse-owned category/trigger IDs (the bot writes those — the
 * form never sends them). The bot picks the change up over realtime and
 * provisions the category + trigger channel live.
 */
export async function savePrivateChannels(
  guildId: string,
  input: PrivateChannelConfig,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const config = normalisePrivateChannelConfig(input)
  const invalid = validatePrivateChannelConfig(config)
  if (invalid) return { ok: false, error: invalid }

  if (config.enabled) {
    const botPresent = await isBotInGuild(guildId)
    if (!botPresent)
      return { ok: false, error: 'The Pulse bot is not installed in this server. Add it first.' }

    const perms = await checkBotPermissions(guildId)
    // null = couldn't verify; treat as a soft-pass (Discord rejects at runtime).
    if (perms !== null) {
      if (!perms.inGuild)
        return { ok: false, error: 'Could not verify bot permissions. Is the bot still in the server?' }
      if (!perms.administrator && !perms.manageChannels)
        return {
          ok: false,
          error: 'Private Channels requires the bot to have the Manage Channels permission (plus Move Members to move people into their channels).',
        }
    }
  }

  // Preserve the Pulse-owned IDs already on the row.
  const { data: existing } = await supabase
    .from('private_channel_configs')
    .select('category_id, trigger_channel_id')
    .eq('guild_id', guildId)
    .maybeSingle()

  const { error } = await supabase.from('private_channel_configs').upsert(
    {
      guild_id: guildId,
      enabled: config.enabled,
      category_name: config.category_name,
      trigger_name: config.trigger_name,
      name_format: config.name_format,
      channel_type: config.channel_type,
      user_limit: config.user_limit,
      default_locked: config.default_locked,
      auto_delete: config.auto_delete,
      auto_delete_delay: config.auto_delete_delay,
      allowed_role_ids: config.allowed_role_ids,
      ignored_role_ids: config.ignored_role_ids,
      per_user_limit: config.per_user_limit,
      allow_owner_management: config.allow_owner_management,
      category_id: existing?.category_id ?? null,
      trigger_channel_id: existing?.trigger_channel_id ?? null,
      updated_at: new Date().toISOString(),
      updated_by: user.user_metadata?.provider_id ?? user.id,
    },
    { onConflict: 'guild_id' },
  )

  if (error) return { ok: false, error: `Failed to save: ${error.message}` }

  const claims = user.user_metadata?.custom_claims as
    | { global_name?: string; username?: string }
    | undefined
  await recordNotification({
    guildId,
    type: 'automation_saved',
    title: 'Private Channels saved',
    body: config.enabled
      ? `Enabled — trigger “${config.trigger_name}” under “${config.category_name}”.`
      : 'Private Channels disabled.',
    link: `/dashboard/${guildId}/private-channels`,
    actorId: user.user_metadata?.provider_id ?? user.id,
    actorName: claims?.global_name ?? claims?.username ?? user.user_metadata?.full_name ?? null,
    actorUsername: claims?.username ?? null,
  })

  return { ok: true }
}

/** Admin force-delete of a live private channel: deletes on Discord + drops the row. */
export async function deletePrivateChannel(guildId: string, channelId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const res = await deleteChannel(channelId, 'Private channel deleted from Pulsify dashboard')
  // 10003 = Unknown Channel — already gone; treat as success and just clear the row.
  if (!res.ok && !/unknown channel/i.test(res.error)) return { ok: false, error: res.error }

  await supabase.from('private_channels').delete().eq('guild_id', guildId).eq('channel_id', channelId)
  return { ok: true }
}

/** Admin force-rename of a live private channel: renames on Discord + updates the row. */
export async function renamePrivateChannel(
  guildId: string,
  channelId: string,
  name: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const trimmed = name.trim().slice(0, PRIVATE_CHANNEL_LIMITS.nameMax)
  if (!trimmed) return { ok: false, error: 'Enter a channel name.' }

  const res = await modifyChannel(channelId, { name: trimmed }, VOICE_CHANNEL_TYPE, 'Renamed from Pulsify dashboard')
  if (!res.ok) return { ok: false, error: res.error }

  await supabase
    .from('private_channels')
    .update({ name: trimmed })
    .eq('guild_id', guildId)
    .eq('channel_id', channelId)
  return { ok: true }
}
