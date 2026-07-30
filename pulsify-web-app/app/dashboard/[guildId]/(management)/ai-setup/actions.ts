'use server'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@/lib/supabase-server'
import { PULSE_BADGES_ENABLED } from '@/lib/pulse-icon'
import {
  MAX_RULE_MESSAGES,
  usableRuleItems,
  type RuleItem,
  type RulesLayout,
} from '@/lib/rules-embed'
import {
  postChannelComponents,
  createGuildChannel,
  type V2Container,
  type V2TextDisplay,
  type V2Attachment,
} from '@/lib/discord'

// A welcome/goodbye greeting is a title and a message, nothing more — see
// buildMemberV2Container in the bot's index.js, which posts exactly that.
type EmbedConfig = {
  color: string
  title: string
  description: string
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

// Pulse content blocks (rules, onboarding) carry their own branded badge — the
// same icons the bot ships in resources/images, mirrored into the web app's
// public/ so the server action can attach them. Keyed by kind so each block
// gets the right icon + footer.
type ContentKind = 'rules' | 'onboarding'
const CONTENT_META: Record<ContentKind, { icon: string; footer: string }> = {
  rules:      { icon: 'pulse-info.png',       footer: 'Pulse — Server Rules' },
  onboarding: { icon: 'pulse-onboarding.png', footer: 'Pulse — Onboarding Guide' },
}

// Load + cache an icon buffer from public/. Absent ⇒ null (the header then
// renders without a badge rather than failing the post).
const iconCache: Record<string, Buffer | null> = {}
function loadIcon(name: string): Buffer | null {
  // Gated on the global Pulse badge switch (see lib/pulse-icon.ts).
  if (!PULSE_BADGES_ENABLED) return null
  if (!(name in iconCache)) {
    try {
      iconCache[name] = readFileSync(path.join(process.cwd(), 'public', name))
    } catch {
      iconCache[name] = null
    }
  }
  return iconCache[name]
}

// Discord auto-sizes a container to its widest line; this run of Braille-blank
// chars (U+2800 — occupies width, isn't trimmed) pins the block to a comfortable
// width. It pads the FOOTER rather than sitting on a line of its own — a
// TextDisplay is a block, so a standalone spacer costs a full empty line between
// the title and the body. Mirrors padToWidth in the bot's commands.js.
const WIDTH_TARGET = 44
const padToWidth = (s: string) => s + '⠀'.repeat(Math.max(0, WIDTH_TARGET - [...s].length))

/**
 * Build a Components V2 container for a posted content block (rules,
 * onboarding), matching the standardized Pulse v2 embed style used by
 * /changelog and announcements: a `Pulse` label + `# title` heading beside the
 * block's branded badge (type-9 Section), a width spacer, the body, then a
 * divider and a `Pulse — …` footer. Returns the container plus the icon
 * attachment to post alongside it (empty when the icon couldn't be loaded).
 */
function buildContentMessage(
  title: string,
  content: string,
  accentHex: string,
  kind: ContentKind,
): { container: V2Container; attachments?: V2Attachment[] } {
  const { icon, footer } = CONTENT_META[kind]
  const iconBuf = loadIcon(icon)

  const headerLines: V2TextDisplay[] = [{ type: 10, content: '**Pulse**' }]
  const trimmedTitle = title.trim()
  if (trimmedTitle) headerLines.push({ type: 10, content: `# ${trimmedTitle}` })

  const components: V2Container['components'] = []
  if (iconBuf) {
    components.push({
      type: 9,
      components: headerLines,
      accessory: { type: 11, media: { url: `attachment://${icon}` }, description: 'Pulse' },
    })
  } else {
    components.push(...headerLines)
  }
  components.push({ type: 10, content: content.slice(0, 3900) })
  components.push({ type: 14, divider: true, spacing: 1 })
  components.push({ type: 10, content: `-# ${padToWidth(footer)}` })

  return {
    container: { type: 17, accent_color: hexToInt(accentHex), components },
    attachments: iconBuf ? [{ filename: icon, data: iconBuf, contentType: 'image/png' }] : undefined,
  }
}

/** Discord allows 5 messages per 5s in a channel. Pace the per-rule posts just
 *  under that so a 6-rule set never trips a 429 (postChannelComponents doesn't
 *  retry). */
const RULE_POST_SPACING_MS = 1100

/**
 * A single rule as its own bare container: the heading and the rule text, and
 * nothing else — no `Pulse` label, no badge, no divider, no footer. Only the
 * accent stripe ties it to the rest of Pulse. Contrast with
 * buildContentMessage, which is the fully branded block.
 */
function buildBareRuleMessage(heading: string, text: string, accentHex: string): V2Container {
  const components: V2Container['components'] = []
  const trimmedHeading = heading.trim()
  if (trimmedHeading) components.push({ type: 10, content: `## ${trimmedHeading}` })
  components.push({ type: 10, content: text.slice(0, 3900) })
  return { type: 17, accent_color: hexToInt(accentHex), components }
}

export async function applyRules(
  guildId: string,
  channelId: string,
  title: string,
  content: string,
  accentHex: string,
  layout: RulesLayout = 'single',
  ruleItems: RuleItem[] = [],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  if (layout === 'per_rule') {
    const rules = usableRuleItems(ruleItems)
    if (rules.length === 0) return { ok: false, error: 'Add at least one rule before posting.' }
    if (rules.length > MAX_RULE_MESSAGES) {
      return {
        ok: false,
        error: `That's ${rules.length} rules — one embed each would flood the channel. Trim to ${MAX_RULE_MESSAGES} or fewer, or switch to a single embed.`,
      }
    }

    for (let i = 0; i < rules.length; i += 1) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, RULE_POST_SPACING_MS))
      const result = await postChannelComponents(
        channelId,
        [buildBareRuleMessage(rules[i].title, rules[i].text, accentHex)],
      )
      if (!result.ok) {
        // Partial post — say how far it got so the user knows what to clean up.
        return i === 0
          ? result
          : { ok: false, error: `Posted ${i} of ${rules.length} rules, then failed: ${result.error}` }
      }
    }
  } else {
    const { container, attachments } = buildContentMessage(title, content, accentHex, 'rules')
    const postResult = await postChannelComponents(channelId, [container], attachments)
    if (!postResult.ok) return postResult
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
      {
        guild_id: guildId,
        settings: {
          ...current,
          rules: { enabled: true, channel_id: channelId, title, content, layout, rule_items: ruleItems },
        },
        updated_at: new Date().toISOString(),
      },
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

  const { container, attachments } = buildContentMessage(title, content, accentHex, 'onboarding')
  const postResult = await postChannelComponents(channelId, [container], attachments)
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
      const chResult = await createGuildChannel(guildId, { name: ch, type: 0, parent_id: catResult.channel.id })
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
