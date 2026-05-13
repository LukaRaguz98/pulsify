'use server'

import { createClient } from '@/lib/supabase-server'
import { unbanUser } from '@/lib/discord'

export type UnbanResult = { ok: true } | { ok: false; error: string }

export async function unbanMember(guildId: string, userId: string): Promise<UnbanResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  return unbanUser(guildId, userId)
}
