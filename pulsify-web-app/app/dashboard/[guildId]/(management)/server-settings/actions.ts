'use server'

import { createClient } from '@/lib/supabase-server'

// Embed colour is the single source of truth for how Pulse's Discord embeds
// look. It lives in guild_settings.settings.embed_color (a #rrggbb hex) so the
// Pulse bot can read it and apply it to every embed it posts. Configured from
// Server Settings › Pulse Assistant (Embed Appearance).

const HEX = /^#[0-9a-fA-F]{6}$/

export async function getEmbedColor(guildId: string): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()

  const color = (data?.settings as Record<string, unknown> | null)?.embed_color
  return typeof color === 'string' && HEX.test(color) ? color : null
}

export async function saveEmbedColor(
  guildId: string,
  hex: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  if (!HEX.test(hex)) return { ok: false, error: 'Embed color must be a #rrggbb hex value.' }

  const { data: existing } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()

  const current = (existing?.settings as Record<string, unknown>) ?? {}
  const merged = { ...current, embed_color: hex }

  const { error } = await supabase
    .from('guild_settings')
    .upsert(
      { guild_id: guildId, settings: merged, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )

  if (error) return { ok: false, error: `Failed to save: ${error.message}` }
  return { ok: true }
}
