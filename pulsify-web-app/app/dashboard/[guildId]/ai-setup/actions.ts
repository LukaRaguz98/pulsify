'use server'

import { createClient } from '@/lib/supabase-server'
import { postChannelEmbed, createGuildChannel } from '@/lib/discord'

type EmbedConfig = {
  color: string
  title: string
  description: string
  fields: { name: string; value: string; inline: boolean }[]
  footer_text: string
  banner_color: string
}

export async function applyWelcomeEmbed(
  guildId: string,
  channelId: string,
  embed: EmbedConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const { data: existing } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()

  const current = (existing?.settings as Record<string, unknown>) ?? {}
  const updated = {
    ...current,
    welcome: {
      ...(current.welcome as Record<string, unknown> ?? {}),
      enabled: true,
      channel_id: channelId,
      type: 'embed',
      embed: {
        color: embed.color,
        title: embed.title,
        description: embed.description,
        fields: embed.fields,
        footer_text: embed.footer_text,
        banner_color: embed.banner_color,
      },
    },
  }

  const { error } = await supabase
    .from('guild_settings')
    .upsert({ guild_id: guildId, settings: updated, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function applyGoodbyeEmbed(
  guildId: string,
  channelId: string,
  embed: EmbedConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const { data: existing } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()

  const current = (existing?.settings as Record<string, unknown>) ?? {}
  const updated = {
    ...current,
    goodbye: {
      ...(current.goodbye as Record<string, unknown> ?? {}),
      enabled: true,
      channel_id: channelId,
      type: 'embed',
      embed: {
        color: embed.color,
        title: embed.title,
        description: embed.description,
        fields: embed.fields,
        footer_text: embed.footer_text,
        banner_color: embed.banner_color,
      },
    },
  }

  const { error } = await supabase
    .from('guild_settings')
    .upsert({ guild_id: guildId, settings: updated, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

export async function applyRules(
  guildId: string,
  channelId: string,
  title: string,
  content: string,
  accentHex: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const postResult = await postChannelEmbed(channelId, {
    color: hexToInt(accentHex),
    title,
    description: content,
  })
  if (!postResult.ok) return postResult

  const { data: existing } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()

  const current = (existing?.settings as Record<string, unknown>) ?? {}
  const { error } = await supabase
    .from('guild_settings')
    .upsert(
      { guild_id: guildId, settings: { ...current, rules: { enabled: true, channel_id: channelId, title, content } }, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function applyOnboarding(
  guildId: string,
  channelId: string,
  title: string,
  content: string,
  accentHex: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const postResult = await postChannelEmbed(channelId, {
    color: hexToInt(accentHex),
    title,
    description: content,
  })
  if (!postResult.ok) return postResult

  const { data: existing } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()

  const current = (existing?.settings as Record<string, unknown>) ?? {}
  const { error } = await supabase
    .from('guild_settings')
    .upsert(
      { guild_id: guildId, settings: { ...current, onboarding: { enabled: true, channel_id: channelId, title, content } }, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function applyChannelsReference(
  guildId: string,
  structure: { category: string; channels: string[] }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  for (const cat of structure) {
    const catResult = await createGuildChannel(guildId, { name: cat.category, type: 4 })
    if (!catResult.ok) return catResult
    for (const ch of cat.channels) {
      const chResult = await createGuildChannel(guildId, { name: ch, type: 0, parent_id: catResult.id })
      if (!chResult.ok) return chResult
    }
  }

  const { data: existing } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()

  const current = (existing?.settings as Record<string, unknown>) ?? {}
  const { error } = await supabase
    .from('guild_settings')
    .upsert(
      { guild_id: guildId, settings: { ...current, channels_reference: { enabled: true, structure } }, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function applyWelcomeMessage(
  guildId: string,
  channelId: string,
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const { data: existing } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()

  const current = (existing?.settings as Record<string, unknown>) ?? {}
  const updated = {
    ...current,
    welcome: {
      ...(current.welcome as Record<string, unknown> ?? {}),
      enabled: true,
      channel_id: channelId,
      message,
    },
  }

  const { error } = await supabase
    .from('guild_settings')
    .upsert({ guild_id: guildId, settings: updated, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
