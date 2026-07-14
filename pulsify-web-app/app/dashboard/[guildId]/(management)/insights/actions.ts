'use server'

import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { createClient } from '@/lib/supabase-server'
import {
  fetchGuild,
  postChannelComponents,
  type V2Container,
  type V2Attachment,
} from '@/lib/discord'
import { getTintedPulseIcon, pulseIconFilename } from '@/lib/pulse-icon'
import { readGuildEmbedHex } from '@/lib/embed-color'
import type { TimeseriesPoint } from '@/lib/analytics'
import {
  splitWindow,
  computeTrends,
  bestActivitySlot,
  buildRecap,
  type HeatmapCell,
  type RecapInput,
  type RecapItem,
} from '@/lib/insights'

const DAY_MS = 86_400_000
const HEATMAP_DAYS = 30
const RECAP_ICON = pulseIconFilename('recap')

/** `#rrggbb` → Discord colour int, falling back to Pulsify violet. */
function hexToInt(hex: string, fallback = 0x8b5cf6): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  return m ? parseInt(m[1], 16) : fallback
}

/**
 * Compose the recap as a Components V2 Container — same visual language as the
 * Pulse Guard alert and AutoMod DM (header section with the tinted badge as a
 * thumbnail, guild accent stripe, bold-label lines, `-#` subtext footer) so it
 * matches every other embed the app posts.
 */
function buildRecapContainer(args: {
  guildName: string
  windowDays: number
  items: RecapItem[]
  hasIcon: boolean
  accentColor: number
}): V2Container {
  const { guildName, windowDays, items, hasIcon, accentColor } = args
  const components: V2Container['components'] = []

  const headerLines = [
    { type: 10 as const, content: `**Pulse**` },
    { type: 10 as const, content: `# Server recap` },
    { type: 10 as const, content: `-# Pulsify Insights — ${guildName} — last ${windowDays} days` },
  ]
  if (hasIcon) {
    components.push({
      type: 9,
      components: headerLines,
      accessory: { type: 11, media: { url: `attachment://${RECAP_ICON}` }, description: 'Pulsify Insights' },
    })
  } else {
    components.push(...headerLines)
  }

  // A short lead-in before the numbers so the post reads as a message, not a dump.
  components.push({
    type: 10,
    content: `### Here's how **${guildName}** has been doing over the past ${windowDays} days.`,
  })
  components.push({ type: 14, divider: true, spacing: 1 })

  // Stats — bold labels, `:` delimiters, one per line. No per-line emoji.
  components.push({ type: 10, content: items.map((it) => `**${it.label}:** ${it.value}`).join('\n') })

  components.push({ type: 14, divider: true, spacing: 1 })
  const unix = Math.floor(Date.now() / 1000)
  components.push({ type: 10, content: `-# Pulse — Insights — <t:${unix}:f>` })

  return { type: 17, accent_color: accentColor, components }
}

/**
 * Compose a fresh insights recap for the period and post it to a Discord
 * channel as a Components V2 embed. Recomputes the numbers server-side (rather
 * than trusting the client) so a posted recap is always accurate. Gated to
 * guild moderators.
 */
export async function postInsightsRecap(
  guildId: string,
  channelId: string,
  windowDaysInput: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!channelId) return { ok: false, error: 'Choose a channel to post to first.' }

  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  // Accept any positive day count (the view now spans 24h…all-time); clamp to a
  // sane range so a bad input can't request an absurd window.
  const windowDays =
    Number.isFinite(windowDaysInput) && windowDaysInput > 0 ? Math.min(Math.round(windowDaysInput), 3650) : 7
  const supabase = await createClient()
  const now = Date.now()
  const trendSince = new Date(now - windowDays * 2 * DAY_MS).toISOString()
  const windowSince = new Date(now - windowDays * DAY_MS).toISOString()
  const heatmapSince = new Date(now - HEATMAP_DAYS * DAY_MS).toISOString()

  const [guild, tsRes, sumRes, heatRes, topRes] = await Promise.all([
    fetchGuild(guildId),
    supabase.rpc('get_analytics_timeseries', { p_guild_id: guildId, p_since: trendSince, p_trunc: 'day' }),
    supabase.rpc('get_analytics_summary', { p_guild_id: guildId, p_since: windowSince }),
    supabase.rpc('get_activity_heatmap', { p_guild_id: guildId, p_since: heatmapSince }),
    supabase.rpc('get_top_channels', { p_guild_id: guildId, p_since: windowSince, p_limit: 1 }),
  ])

  if (!guild) return { ok: false, error: 'Could not load this server.' }
  if (tsRes.error ?? sumRes.error) {
    return { ok: false, error: 'Could not load analytics for the recap.' }
  }

  const series = (tsRes.data ?? []) as TimeseriesPoint[]
  const { current, previous } = splitWindow(series, windowDays, now)
  const trends = computeTrends(current, previous)
  const activeUsers = Number((sumRes.data?.[0] as { active_users?: number } | undefined)?.active_users ?? 0)
  const peakSlot = heatRes.error ? null : bestActivitySlot((heatRes.data ?? []) as HeatmapCell[])
  const topChannel = topRes.error
    ? null
    : ((topRes.data?.[0] as { channel_name?: string | null } | undefined)?.channel_name ?? null)
  const totalMembers = guild.approximate_member_count ?? guild.member_count ?? 0

  const input: RecapInput = { windowDays, current, trends, activeUsers, totalMembers, peakSlot, topChannel }
  const items = buildRecap(input)

  // Accent + icon tint follow the guild's embed colour from Server Settings —
  // the single source of truth for every Pulse embed. Falls back to Pulsify violet.
  const embedColor = await readGuildEmbedHex(supabase, guildId)
  const iconBuffer = await getTintedPulseIcon('recap', embedColor)
  const attachments: V2Attachment[] = iconBuffer
    ? [{ filename: RECAP_ICON, data: iconBuffer, contentType: 'image/png' }]
    : []

  const container = buildRecapContainer({
    guildName: guild.name,
    windowDays,
    items,
    hasIcon: iconBuffer !== null,
    accentColor: hexToInt(embedColor),
  })

  return postChannelComponents(channelId, [container], attachments)
}
