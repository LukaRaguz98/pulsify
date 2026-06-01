'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase-server'
import { requireOperator } from '@/lib/operator'
import { getTintedPulseIcon } from '@/lib/pulse-icon'
import { recordNotification } from '@/lib/notifications-server'
import {
  fetchGuildChannels,
  checkBotPermissions,
  postChannelComponentsReturningId,
  botInviteUrl,
  CHANNEL_TYPES,
  type V2TopLevelComponent,
  type V2Attachment,
} from '@/lib/discord'
import { getReleases } from '@/lib/release-notes'
import { toChangelogRelease, type ChangelogRelease } from '@/lib/release-notes-types'
import {
  validatePresenceDraft,
  draftToRow,
  type PresenceDraft,
} from '@/lib/presence'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/presence`)
}

/**
 * Authorise a presence write. Pulse has a single bot-wide presence, so it is
 * NOT a per-server admin setting — only the configured Pulsify operator(s) may
 * change it (see lib/operator.ts). Returns the operator's Discord user id.
 */
async function authorizePresence() {
  const op = await requireOperator()
  if (!op.ok) return { ok: false as const, error: op.error }
  return { ok: true as const, userId: op.userId }
}

/**
 * Save this guild's presence config. Does NOT change which guild is "active" —
 * use setActivePresence for that. The bot only re-renders if this guild is the
 * one currently driving the presence (it watches guild_presence over realtime).
 */
export async function savePresenceConfig(
  guildId: string,
  draft: PresenceDraft,
): Promise<ActionResult> {
  const validationError = validatePresenceDraft(draft)
  if (validationError) return { ok: false, error: validationError }

  const auth = await authorizePresence()
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase.from('guild_presence').upsert(
    {
      guild_id: guildId,
      ...draftToRow(draft),
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    },
    { onConflict: 'guild_id' },
  )
  if (error) return { ok: false, error: `Failed to save presence: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}

/**
 * Claim the bot-wide presence for this guild: point bot_presence_state at it so
 * Pulse's global status starts following this server's config. Also flips the
 * guild's `enabled` flag on so a disabled config doesn't silently no-op.
 * Last-writer-wins across servers (the UI warns it's bot-wide).
 */
export async function setActivePresence(guildId: string): Promise<ActionResult> {
  const auth = await authorizePresence()
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()

  // Ensure a config row exists and is enabled before it can drive the bot.
  const { error: enableErr } = await supabase.from('guild_presence').upsert(
    { guild_id: guildId, enabled: true, updated_at: new Date().toISOString(), updated_by: auth.userId },
    { onConflict: 'guild_id' },
  )
  if (enableErr) return { ok: false, error: `Failed to enable presence: ${enableErr.message}` }

  const { error } = await supabase.from('bot_presence_state').upsert(
    { id: 1, active_guild_id: guildId, updated_at: new Date().toISOString(), updated_by: auth.userId },
    { onConflict: 'id' },
  )
  if (error) return { ok: false, error: `Failed to set active presence: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}

/**
 * Release the bot-wide presence (revert Pulse to its default status). Only the
 * guild currently driving the presence may clear it.
 */
export async function clearActivePresence(guildId: string): Promise<ActionResult> {
  const auth = await authorizePresence()
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { data: state } = await supabase
    .from('bot_presence_state')
    .select('active_guild_id')
    .eq('id', 1)
    .maybeSingle()
  if (state?.active_guild_id && state.active_guild_id !== guildId) {
    return { ok: false, error: 'Another server is currently driving the presence.' }
  }

  const { error } = await supabase.from('bot_presence_state').upsert(
    { id: 1, active_guild_id: null, updated_at: new Date().toISOString(), updated_by: auth.userId },
    { onConflict: 'id' },
  )
  if (error) return { ok: false, error: `Failed to clear active presence: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}

/**
 * Convenience toggle for maintenance mode — saves just the maintenance fields
 * so admins can flip downtime on/off without re-saving the whole editor.
 */
export async function setMaintenanceMode(
  guildId: string,
  on: boolean,
  text?: string,
): Promise<ActionResult> {
  const auth = await authorizePresence()
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase.from('guild_presence').upsert(
    {
      guild_id: guildId,
      maintenance_mode: on,
      maintenance_text: text?.slice(0, 128) || null,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    },
    { onConflict: 'guild_id' },
  )
  if (error) return { ok: false, error: `Failed to update maintenance mode: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}

// ── Publish changelog (post the /changelog embed to a server channel) ─────────
//
// Lets the operator announce a release straight from the dashboard, posting the
// EXACT same Components V2 embed the /changelog command renders — so the server
// sees a clean Pulse post with no trace of a slash command being invoked. The
// builder below mirrors pulse-bot/src/commands.js buildChangelogContainer.

const CHANGELOG_ICON = 'pulse-annoucement.png'
const DEFAULT_PULSE_COLOR = '#8b5cf6'

const td = (content: string) => ({ type: 10, content })
const sep = () => ({ type: 14, divider: true, spacing: 1 })
// Same invisible Braille-blank run the bot uses to pin the embed to a
// comfortable width regardless of how short the content is.
const WIDTH_SPACER = td(`-# ${'⠀'.repeat(44)}`)
// Lead paragraph a notch larger than body text (a Discord `###` subheading),
// matching the bot's lead().
const lead = (content: string) => td(`### ${content}`)

const HIGHLIGHT_MAX = 25
const HIGHLIGHT_LINE_MAX = 320

function truncate(str: string, max: number): string {
  if (!str || str.length <= max) return str ?? ''
  return `${str.slice(0, max - 1).trimEnd()}…`
}

/** Read the guild's configured Pulse Guard accent colour (defaults to violet). */
async function pulseColor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
): Promise<string> {
  try {
    const { data } = await supabase
      .from('ai_moderation_settings')
      .select('settings')
      .eq('guild_id', guildId)
      .maybeSingle()
    const color = (data?.settings as { embed_color?: string } | null)?.embed_color
    return /^#[0-9a-fA-F]{6}$/.test(color ?? '') ? color! : DEFAULT_PULSE_COLOR
  } catch {
    return DEFAULT_PULSE_COLOR
  }
}

/** Absolute base URL of this deployment, for the embed's link buttons. */
async function appBaseUrl(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return process.env.APP_URL ?? 'http://localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/** The three link buttons every /changelog embed carries (style-5, no handler). */
function linkButtonRow(baseUrl: string, guildId: string) {
  return {
    type: 1,
    components: [
      { type: 2, style: 5, label: 'View Release Notes', url: `${baseUrl}/release-notes` },
      { type: 2, style: 5, label: 'Open Dashboard', url: `${baseUrl}/dashboard/${guildId}` },
      { type: 2, style: 5, label: 'Invite Pulse', url: botInviteUrl(guildId) },
    ],
  }
}

/** Build the /changelog container for a release — mirrors the bot exactly. */
function changelogContainer(
  release: ChangelogRelease,
  opts: { colorHex: string; hasIcon: boolean; baseUrl: string; guildId: string },
): V2TopLevelComponent {
  const colorInt = parseInt(opts.colorHex.replace('#', ''), 16)
  const subtitle = `Pulse \`v${release.version}\` · Released ${release.date}`
  const headerLines = [td('**Pulse**'), td(`# ${release.title}`), td(`-# ${subtitle}`)]

  const body: Record<string, unknown>[] = []
  if (opts.hasIcon) {
    body.push({
      type: 9,
      components: headerLines,
      accessory: { type: 11, media: { url: `attachment://${CHANGELOG_ICON}` }, description: 'Pulse changelog' },
    })
  } else {
    body.push(...headerLines)
  }
  body.push(WIDTH_SPACER)

  if (release.description) body.push(lead(release.description))

  const shown = release.highlights.slice(0, HIGHLIGHT_MAX)
  if (shown.length > 0) {
    body.push(sep())
    body.push(td("**What's new**"))
    const lines = shown.map((h) => `- ${truncate(h, HIGHLIGHT_LINE_MAX)}`)
    const extra = release.highlights.length - shown.length
    if (extra > 0) lines.push(`-# …and ${extra} more — see the full release notes`)
    body.push(td(lines.join('\n')))
  }

  if (release.outro) {
    body.push(sep())
    body.push(td(`-# ${truncate(release.outro, 240)}`))
  }

  body.push(linkButtonRow(opts.baseUrl, opts.guildId))
  body.push(td('-# Pulse · Change Log'))

  return {
    type: 17,
    accent_color: Number.isNaN(colorInt) ? 0x8b5cf6 : colorInt,
    components: body,
  } as unknown as V2TopLevelComponent
}

/**
 * Verify the target channel exists, is text/announcement, and that Pulse can
 * post there. Returns an error string when publishing should be blocked, or
 * null when it's safe to post (mirrors announcements' preflight).
 */
async function preflightChannel(guildId: string, channelId: string): Promise<string | null> {
  const [channels, perms] = await Promise.all([fetchGuildChannels(guildId), checkBotPermissions(guildId)])
  const channel = channels.find((c) => c.id === channelId)
  if (!channel) return 'That channel no longer exists. Pick another one.'
  if (channel.type !== CHANNEL_TYPES.TEXT && channel.type !== CHANNEL_TYPES.ANNOUNCEMENT) {
    return 'The changelog can only be posted to a text or announcement channel.'
  }
  if (perms === null) return null // couldn't determine perms — let the post try
  if (!perms.inGuild) return 'Pulse is not in this server. Invite it, then try again.'
  if (!perms.administrator && !perms.sendMessages) {
    return "Pulse can't send messages in this server. Grant it the Send Messages permission."
  }
  return null
}

/**
 * Publish a release's changelog embed to a server channel. Operator-only (this
 * lives in the bot-wide Presence surface). Posts the identical /changelog embed
 * so the server sees a polished Pulse post with no slash-command attribution.
 */
export async function publishChangelog(
  guildId: string,
  input: { version: string; channelId: string },
): Promise<ActionResult> {
  const auth = await authorizePresence()
  if (!auth.ok) return { ok: false, error: auth.error }

  if (!input.channelId) return { ok: false, error: 'Pick a channel to post the changelog to.' }

  const release = (await getReleases()).find((r) => r.version === input.version)
  if (!release) return { ok: false, error: 'That release could not be found.' }
  const changelog = toChangelogRelease(release)

  const blocked = await preflightChannel(guildId, input.channelId)
  if (blocked) return { ok: false, error: blocked }

  const supabase = await createClient()
  const colorHex = await pulseColor(supabase, guildId)

  // Tint the announcement badge to the guild accent — the same icon /changelog
  // attaches. Absent ⇒ the header just renders without a badge.
  const iconBuffer = await getTintedPulseIcon('announcement', colorHex)
  const attachments: V2Attachment[] | undefined = iconBuffer
    ? [{ filename: CHANGELOG_ICON, data: iconBuffer, contentType: 'image/png' }]
    : undefined

  const baseUrl = await appBaseUrl()
  const container = changelogContainer(changelog, {
    colorHex,
    hasIcon: iconBuffer !== null,
    baseUrl,
    guildId,
  })

  const posted = await postChannelComponentsReturningId(input.channelId, [container], attachments)
  if (!posted.ok) {
    await recordNotification({
      guildId,
      type: 'announcement_failed',
      title: `Changelog failed: v${changelog.version}`,
      body: posted.error,
      link: `/dashboard/${guildId}/presence`,
      actorId: auth.userId,
      targetId: input.channelId,
      metadata: { kind: 'changelog', version: changelog.version },
    })
    return { ok: false, error: `Couldn't post the changelog: ${posted.error}` }
  }

  await recordNotification({
    guildId,
    type: 'announcement_published',
    title: `Changelog published: v${changelog.version}`,
    body: `Posted ${changelog.title} to <#${input.channelId}>`,
    link: `/dashboard/${guildId}/presence`,
    actorId: auth.userId,
    targetId: input.channelId,
    metadata: { kind: 'changelog', version: changelog.version, message_id: posted.messageId },
  })

  return { ok: true }
}
