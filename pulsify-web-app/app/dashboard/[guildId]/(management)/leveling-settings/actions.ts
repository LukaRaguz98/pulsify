'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import {
  normaliseLevelingSettings,
  serialiseLevelingSettings,
  type LevelingConfig,
} from '@/lib/leveling'

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Persist a guild's leveling configuration. The config is re-normalised
 * server-side (clamps + defaults) before saving so a tampered payload can't
 * write out-of-range values. A missing row already means "enabled defaults", so
 * we only write a row once the admin saves.
 */
export async function saveLevelingSettings(
  guildId: string,
  config: LevelingConfig,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const clean = normaliseLevelingSettings({
    enabled: config.enabled,
    settings: config as unknown as Record<string, unknown>,
  })
  const { enabled, settings } = serialiseLevelingSettings(clean)

  const supabase = await createClient()
  const { error } = await supabase.from('leveling_settings').upsert(
    {
      guild_id: guildId,
      enabled,
      settings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'guild_id' },
  )
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/dashboard/${guildId}/leveling-settings`)
  revalidatePath(`/dashboard/${guildId}/members`)
  return { ok: true }
}
