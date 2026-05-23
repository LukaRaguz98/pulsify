'use server'

import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { fetchGuildFresh } from '@/lib/discord'

export type SyncResult = { ok: true; memberCount: number | null } | { ok: false; error: string }

/**
 * Refresh the dashboard's cached copy of this server's metadata from Discord.
 * Mirrors the bot's `/sync` (`syncGuild`) — it upserts the same `synced_guilds`
 * row (name, icon, owner, member count) so the dashboard reflects the latest
 * state without waiting for the bot to re-sync. Exposed as a command-palette
 * quick action.
 */
export async function triggerGuildSync(guildId: string): Promise<SyncResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const guild = await fetchGuildFresh(guildId)
  if (!guild) return { ok: false, error: "Couldn't reach Discord to sync this server. Try again in a moment." }

  const memberCount = guild.approximate_member_count ?? guild.member_count ?? null
  const supabase = await createClient()
  const { error } = await supabase.from('synced_guilds').upsert(
    {
      guild_id: guild.id,
      name: guild.name,
      icon: guild.icon,
      owner_id: guild.owner_id,
      member_count: memberCount,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'guild_id' },
  )
  if (error) return { ok: false, error: `Sync failed: ${error.message}` }

  return { ok: true, memberCount }
}
