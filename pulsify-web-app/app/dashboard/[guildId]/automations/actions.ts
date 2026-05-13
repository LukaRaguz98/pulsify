'use server'

import { createClient } from '@/lib/supabase-server'

export async function saveAutomations(
  guildId: string,
  settings: Record<string, unknown>
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Unauthorized')

  await supabase.from('guild_settings').upsert(
    {
      guild_id: guildId,
      settings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'guild_id' }
  )
}
