'use server'

import { createClient } from '@/lib/supabase-server'
import { isBotInGuild, checkBotPermissions, deleteChannel, modifyChannel, fetchChannel, createGuildChannel } from '@/lib/discord'
import { recordNotification } from '@/lib/notifications-server'
import {
  type PrivateChannelConfig,
  PRIVATE_CHANNEL_LIMITS,
  normalisePrivateChannelConfig,
  validatePrivateChannelConfig,
} from '@/lib/private-channels'

export type ActionResult = { ok: true } | { ok: false; error: string }

// Discord channel types.
const VOICE_CHANNEL_TYPE = 2
const CATEGORY_CHANNEL_TYPE = 4

/**
 * Create the category + trigger voice channel for a guild straight from the
 * dashboard (over the bot-token REST API), returning their IDs. We do NOT rely
 * on the bot to provision: realtime delivery to the bot can be unreliable (and
 * the bot may be down), which is why a save / re-create could appear to do
 * nothing. Provisioning here makes the channels appear immediately regardless of
 * the bot's state; the bot still owns the runtime (join-to-create, sweep, panel)
 * and picks up the stored IDs. Idempotent: only creates what's actually missing
 * (verified over fresh REST, not the bot's gateway cache).
 *
 * Returns the resolved IDs WITHOUT writing the DB, so the caller can persist
 * them in the same row write that the bot reacts to over realtime — that way the
 * bot only ever sees valid IDs and won't race us into creating duplicates.
 */
async function ensureProvisioned(
  guildId: string,
  opts: { categoryName: string; triggerName: string; categoryId: string | null; triggerChannelId: string | null },
): Promise<{ ok: true; categoryId: string; triggerChannelId: string } | { ok: false; error: string }> {
  let categoryId = opts.categoryId
  if (!categoryId || !(await fetchChannel(categoryId))) {
    const res = await createGuildChannel(
      guildId,
      { name: opts.categoryName || 'Private Channels', type: CATEGORY_CHANNEL_TYPE },
      'Pulsify — Private Channels',
    )
    if (!res.ok) return { ok: false, error: `Couldn't create the category: ${res.error}` }
    categoryId = res.channel.id
  }

  let triggerChannelId = opts.triggerChannelId
  if (!triggerChannelId || !(await fetchChannel(triggerChannelId))) {
    const res = await createGuildChannel(
      guildId,
      { name: opts.triggerName || 'Private Channel +', type: VOICE_CHANNEL_TYPE, parent_id: categoryId },
      'Pulsify — Private Channels',
    )
    if (!res.ok) return { ok: false, error: `Couldn't create the trigger channel: ${res.error}` }
    triggerChannelId = res.channel.id
  }

  return { ok: true, categoryId, triggerChannelId }
}

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

  const { data: existing } = await supabase
    .from('private_channel_configs')
    .select('category_id, trigger_channel_id')
    .eq('guild_id', guildId)
    .maybeSingle()

  // Provision the category + trigger FIRST (over REST), so the single config
  // write below already carries valid IDs. That keeps the bot — which reacts to
  // this write over realtime — from racing us into creating duplicates. When
  // disabled we leave the stored IDs as-is (the bot won't act on a disabled row).
  let categoryId = existing?.category_id ?? null
  let triggerChannelId = existing?.trigger_channel_id ?? null
  if (config.enabled) {
    const provisioned = await ensureProvisioned(guildId, {
      categoryName: config.category_name,
      triggerName: config.trigger_name,
      categoryId,
      triggerChannelId,
    })
    if (!provisioned.ok) return provisioned
    categoryId = provisioned.categoryId
    triggerChannelId = provisioned.triggerChannelId
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
 * guild. Use when the admin deleted them in Discord — the dashboard can't
 * re-save an unchanged config, so this gives an explicit "re-create" trigger.
 * Creates the channels directly over REST (not via the bot) so they reappear
 * immediately even if the bot is offline or realtime isn't reaching it.
 */
export async function reprovisionPrivateChannels(guildId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const { data: row } = await supabase
    .from('private_channel_configs')
    .select('enabled, category_name, trigger_name, category_id, trigger_channel_id')
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

  const provisioned = await ensureProvisioned(guildId, {
    categoryName: (row.category_name as string) || 'Private Channels',
    triggerName: (row.trigger_name as string) || 'Private Channel +',
    categoryId: (row.category_id as string | null) ?? null,
    triggerChannelId: (row.trigger_channel_id as string | null) ?? null,
  })
  if (!provisioned.ok) return provisioned

  const { error } = await supabase
    .from('private_channel_configs')
    .update({
      category_id: provisioned.categoryId,
      trigger_channel_id: provisioned.triggerChannelId,
      updated_at: new Date().toISOString(),
    })
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to save channel IDs: ${error.message}` }
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
