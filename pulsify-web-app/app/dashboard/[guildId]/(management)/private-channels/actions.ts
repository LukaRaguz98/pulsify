'use server'

import { createClient } from '@/lib/supabase-server'
import { isBotInGuild, checkBotPermissions, deleteChannel, modifyChannel, fetchChannel } from '@/lib/discord'
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

  // Preserve the Pulse-owned IDs already on the row — but only if those channels
  // still exist. The bot recreates a missing category/trigger by checking its
  // gateway channel CACHE; if it missed the ChannelDelete event (a disconnect,
  // a restart, or a stale cache) when an admin deleted them in Discord, the row
  // keeps pointing at dead channels and the bot never recreates them — saving
  // here does "nothing". We verify over fresh REST (not the bot's cache) and
  // null out any dead IDs, so the bot's ensureProvisioned sees a null id and
  // recreates unconditionally on the next config update.
  const { data: existing } = await supabase
    .from('private_channel_configs')
    .select('category_id, trigger_channel_id')
    .eq('guild_id', guildId)
    .maybeSingle()

  let categoryId = existing?.category_id ?? null
  let triggerChannelId = existing?.trigger_channel_id ?? null
  if (config.enabled) {
    if (categoryId && !(await fetchChannel(categoryId))) categoryId = null
    if (triggerChannelId && !(await fetchChannel(triggerChannelId))) triggerChannelId = null
  }

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
      category_id: categoryId,
      trigger_channel_id: triggerChannelId,
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

/**
 * Force Pulse to (re)create the category + trigger channel for an already-enabled
 * guild. Use when the admin deleted them in Discord and the bot didn't pick it up
 * — the dashboard can't re-save an unchanged config, so this gives an explicit
 * "re-create" trigger. We null out any dead IDs (verified over fresh REST, not
 * the bot's gateway cache) and bump `updated_at` so the bot's realtime handler
 * re-runs ensureProvisioned and recreates whatever's missing.
 */
export async function reprovisionPrivateChannels(guildId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const { data: row } = await supabase
    .from('private_channel_configs')
    .select('enabled, category_id, trigger_channel_id')
    .eq('guild_id', guildId)
    .maybeSingle()

  if (!row?.enabled) return { ok: false, error: 'Enable Private Channels and save first.' }

  const botPresent = await isBotInGuild(guildId)
  if (!botPresent)
    return { ok: false, error: 'The Pulse bot is not installed in this server. Add it first.' }

  const perms = await checkBotPermissions(guildId)
  if (perms !== null && perms.inGuild && !perms.administrator && !perms.manageChannels)
    return {
      ok: false,
      error: 'Private Channels requires the bot to have the Manage Channels permission.',
    }

  let categoryId = (row.category_id as string | null) ?? null
  let triggerChannelId = (row.trigger_channel_id as string | null) ?? null
  if (categoryId && !(await fetchChannel(categoryId))) categoryId = null
  if (triggerChannelId && !(await fetchChannel(triggerChannelId))) triggerChannelId = null

  const { error } = await supabase
    .from('private_channel_configs')
    .update({
      category_id: categoryId,
      trigger_channel_id: triggerChannelId,
      updated_at: new Date().toISOString(),
    })
    .eq('guild_id', guildId)

  if (error) return { ok: false, error: `Failed to trigger re-create: ${error.message}` }
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
