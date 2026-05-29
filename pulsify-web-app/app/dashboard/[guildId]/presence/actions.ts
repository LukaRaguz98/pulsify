'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { requireOperator } from '@/lib/operator'
import {
  validatePresenceDraft,
  draftToRow,
  type PresenceDraft,
} from '@/lib/presence'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/presence`)
}

/**
 * Authorise a presence write. Pulse has a single bot-wide presence, so it is
 * NOT a per-server admin setting — only the configured Pulsify operator(s) may
 * change it (see lib/operator.ts). Returns the operator's Discord user id.
 */
async function authorizePresence() {
  const op = await requireOperator()
  if (!op.ok) return { ok: false as const, error: op.error }
  return { ok: true as const, userId: op.userId }
}

/**
 * Save this guild's presence config. Does NOT change which guild is "active" —
 * use setActivePresence for that. The bot only re-renders if this guild is the
 * one currently driving the presence (it watches guild_presence over realtime).
 */
export async function savePresenceConfig(
  guildId: string,
  draft: PresenceDraft,
): Promise<ActionResult> {
  const validationError = validatePresenceDraft(draft)
  if (validationError) return { ok: false, error: validationError }

  const auth = await authorizePresence()
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase.from('guild_presence').upsert(
    {
      guild_id: guildId,
      ...draftToRow(draft),
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    },
    { onConflict: 'guild_id' },
  )
  if (error) return { ok: false, error: `Failed to save presence: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}

/**
 * Claim the bot-wide presence for this guild: point bot_presence_state at it so
 * Pulse's global status starts following this server's config. Also flips the
 * guild's `enabled` flag on so a disabled config doesn't silently no-op.
 * Last-writer-wins across servers (the UI warns it's bot-wide).
 */
export async function setActivePresence(guildId: string): Promise<ActionResult> {
  const auth = await authorizePresence()
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()

  // Ensure a config row exists and is enabled before it can drive the bot.
  const { error: enableErr } = await supabase.from('guild_presence').upsert(
    { guild_id: guildId, enabled: true, updated_at: new Date().toISOString(), updated_by: auth.userId },
    { onConflict: 'guild_id' },
  )
  if (enableErr) return { ok: false, error: `Failed to enable presence: ${enableErr.message}` }

  const { error } = await supabase.from('bot_presence_state').upsert(
    { id: 1, active_guild_id: guildId, updated_at: new Date().toISOString(), updated_by: auth.userId },
    { onConflict: 'id' },
  )
  if (error) return { ok: false, error: `Failed to set active presence: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}

/**
 * Release the bot-wide presence (revert Pulse to its default status). Only the
 * guild currently driving the presence may clear it.
 */
export async function clearActivePresence(guildId: string): Promise<ActionResult> {
  const auth = await authorizePresence()
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { data: state } = await supabase
    .from('bot_presence_state')
    .select('active_guild_id')
    .eq('id', 1)
    .maybeSingle()
  if (state?.active_guild_id && state.active_guild_id !== guildId) {
    return { ok: false, error: 'Another server is currently driving the presence.' }
  }

  const { error } = await supabase.from('bot_presence_state').upsert(
    { id: 1, active_guild_id: null, updated_at: new Date().toISOString(), updated_by: auth.userId },
    { onConflict: 'id' },
  )
  if (error) return { ok: false, error: `Failed to clear active presence: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}

/**
 * Convenience toggle for maintenance mode — saves just the maintenance fields
 * so admins can flip downtime on/off without re-saving the whole editor.
 */
export async function setMaintenanceMode(
  guildId: string,
  on: boolean,
  text?: string,
): Promise<ActionResult> {
  const auth = await authorizePresence()
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase.from('guild_presence').upsert(
    {
      guild_id: guildId,
      maintenance_mode: on,
      maintenance_text: text?.slice(0, 128) || null,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    },
    { onConflict: 'guild_id' },
  )
  if (error) return { ok: false, error: `Failed to update maintenance mode: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}
