'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { requireOperator } from '@/lib/operator'
import {
  normaliseRewardSettings,
  serialiseRewardSettings,
  type RewardConfig,
} from '@/lib/economy-rewards'

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Persist a guild's earning configuration. OPERATOR-ONLY: earning rules mint
 * the global Pulse Coin economy, so only the Pulsify operator may change them
 * (same gate as global coin grants in Controls). Re-normalised server-side
 * (clamps + defaults) so a tampered payload can't write out-of-range
 * amounts/multipliers. A missing row already means "enabled with defaults", so
 * we only write a row once it's saved.
 */
export async function saveRewardSettings(
  guildId: string,
  config: RewardConfig,
): Promise<ActionResult> {
  const auth = await requireOperator()
  if (!auth.ok) return { ok: false, error: auth.error }

  const clean = normaliseRewardSettings({
    enabled: config.enabled,
    settings: config as unknown as Record<string, unknown>,
  })
  const settings = serialiseRewardSettings(clean)

  const supabase = await createClient()
  const { error } = await supabase.from('economy_reward_settings').upsert(
    {
      guild_id: guildId,
      enabled: clean.enabled,
      settings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'guild_id' },
  )
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/dashboard/${guildId}/economy-earning`)
  revalidatePath(`/dashboard/${guildId}/economy`)
  return { ok: true }
}
