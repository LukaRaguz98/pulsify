import type { createClient } from '@/lib/supabase-server'

// The guild's configured Pulse embed accent (Server Settings › Pulse Assistant →
// Embed Appearance) lives in guild_settings.settings.embed_color as a #rrggbb
// hex. This is the single source of truth applied to every Pulse embed. Server
// routes that post embeds on the bot's behalf (e.g. self-role menus, rules) read
// it through here so they match what the bot posts.

export const DEFAULT_EMBED_HEX = '#8b5cf6' // Pulsify violet
export const DEFAULT_EMBED_INT = 0x8b5cf6

const HEX = /^#[0-9a-fA-F]{6}$/

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

/** Convert a `#rrggbb` hex to a Discord integer colour (violet on bad input). */
export function embedHexToInt(hex?: string | null): number {
  if (!HEX.test(hex ?? '')) return DEFAULT_EMBED_INT
  const n = parseInt((hex as string).slice(1), 16)
  return Number.isNaN(n) ? DEFAULT_EMBED_INT : n
}

/** Read the guild's embed colour as `#rrggbb` (violet default). */
export async function readGuildEmbedHex(supabase: SupabaseClient, guildId: string): Promise<string> {
  const { data } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()
  const color = (data?.settings as Record<string, unknown> | null)?.embed_color
  return typeof color === 'string' && HEX.test(color) ? color : DEFAULT_EMBED_HEX
}

/** Read the guild's embed colour as a Discord integer (violet default). */
export async function readGuildEmbedInt(supabase: SupabaseClient, guildId: string): Promise<number> {
  return embedHexToInt(await readGuildEmbedHex(supabase, guildId))
}
