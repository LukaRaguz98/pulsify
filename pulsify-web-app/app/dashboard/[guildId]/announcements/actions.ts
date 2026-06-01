'use server'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import {
  fetchGuildChannels,
  checkBotPermissions,
  postChannelComponentsReturningId,
  deleteChannelMessage,
  CHANNEL_TYPES,
  type V2TopLevelComponent,
  type V2Attachment,
} from '@/lib/discord'
import {
  validateDraft,
  normaliseAnnouncement,
  ANNOUNCEMENT_LIMITS,
  type Announcement,
  type AnnouncementDraft,
} from '@/lib/announcements'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

// Pulse brand violet — the accent on the /changelog embed; reused here so an
// announcement reads as the same family of Pulse messages.
const BRAND = 0x8b5cf6

// Pulse announcement badge — attached as the header thumbnail, identical to the
// icon the bot ships (pulse-annoucement.png) so an announcement looks the same
// however it was sent. Loaded once; absent ⇒ the header renders without a badge.
const ICON_NAME = 'pulse-annoucement.png'
let ICON_BUFFER: Buffer | null = null
try {
  ICON_BUFFER = readFileSync(path.join(process.cwd(), 'public', ICON_NAME))
} catch {
  ICON_BUFFER = null
}
const HAS_ICON = ICON_BUFFER !== null
const iconAttachments = (): V2Attachment[] | undefined =>
  HAS_ICON ? [{ filename: ICON_NAME, data: ICON_BUFFER!, contentType: 'image/png' }] : undefined

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/announcements`)
}

// ── Discord embed (mirrors pulse-bot buildChangelogContainer / Pulse v2) ──────

const td = (content: string) => ({ type: 10, content })
const divider = () => ({ type: 14, divider: true, spacing: 1 })

// Discord auto-sizes a container to its widest line; this run of Braille-blank
// chars (U+2800 — occupies width, isn't trimmed) pins the embed to a comfortable
// width like the bot's WIDTH_SPACER does, so short announcements don't render
// cramped. Rendered as subtext so it adds almost no height.
const WIDTH_SPACER = td(`-# ${'⠀'.repeat(44)}`)

function formatLongDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/**
 * Build the announcement container. Matches the /changelog layout: a `Pulse`
 * label + `# title` heading beside the announcement badge (type-9 Section), a
 * `-# Announcement · <date>` subtitle, a width spacer, the message body, then a
 * divider and a `Pulse · Announcement` footer. `publishedAt` dates the subtitle
 * (now, for a fresh publish or preview).
 */
function announcementContainer(a: {
  title: string
  content: string
  publishedAt?: Date
}): V2TopLevelComponent {
  const subtitle = `Announcement · ${formatLongDate(a.publishedAt ?? new Date())}`
  const headerLines = [td('**Pulse**'), td(`# ${a.title}`), td(`-# ${subtitle}`)]

  const body: Record<string, unknown>[] = []
  if (HAS_ICON) {
    body.push({
      type: 9,
      components: headerLines,
      accessory: { type: 11, media: { url: `attachment://${ICON_NAME}` }, description: 'Pulse announcement' },
    })
  } else {
    body.push(...headerLines)
  }
  body.push(WIDTH_SPACER)
  // The message body. Split on blank lines into separate text displays so the
  // paragraph spacing survives (a single text display collapses blank lines).
  const paragraphs = a.content.trim().slice(0, ANNOUNCEMENT_LIMITS.maxContent).split(/\n{2,}/)
  for (const p of paragraphs) body.push(td(p.trim()))
  body.push(divider())
  body.push(td('-# Pulse · Announcement'))

  return { type: 17, accent_color: BRAND, components: body } as unknown as V2TopLevelComponent
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function loadAnnouncement(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
  id: string,
): Promise<Announcement | null> {
  const { data } = await supabase
    .from('announcements')
    .select('*')
    .eq('id', id)
    .eq('guild_id', guildId)
    .maybeSingle()
  return data ? normaliseAnnouncement(data as Record<string, unknown>) : null
}

/**
 * Verify the target channel exists, is a text/announcement channel, and that
 * Pulse can post there. Returns an error string when publishing should be
 * blocked, or null when it's safe to post. Keeps users out of the failure path
 * for the common, knowable problems (no bot, wrong channel, missing perms).
 */
async function preflightChannel(guildId: string, channelId: string): Promise<string | null> {
  const [channels, perms] = await Promise.all([
    fetchGuildChannels(guildId),
    checkBotPermissions(guildId),
  ])
  const channel = channels.find((c) => c.id === channelId)
  if (!channel) return 'That channel no longer exists. Pick another one.'
  if (channel.type !== CHANNEL_TYPES.TEXT && channel.type !== CHANNEL_TYPES.ANNOUNCEMENT) {
    return 'Announcements can only be posted to a text or announcement channel.'
  }
  if (perms === null) return null // couldn't determine perms — let the post try
  if (!perms.inGuild) return 'Pulse is not in this server. Invite it, then try again.'
  if (!perms.administrator && !perms.sendMessages) {
    return "Pulse can't send messages in this server. Grant it the Send Messages permission."
  }
  return null
}

/** Post the announcement embed and return the new message id, or an error. */
async function publishToDiscord(
  channelId: string,
  a: { title: string; content: string },
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  return postChannelComponentsReturningId(
    channelId,
    [announcementContainer({ title: a.title, content: a.content, publishedAt: new Date() })],
    iconAttachments(),
  )
}

function buildDraftFields(draft: AnnouncementDraft) {
  return {
    title: draft.title.trim().slice(0, ANNOUNCEMENT_LIMITS.maxTitle),
    content: draft.content.trim().slice(0, ANNOUNCEMENT_LIMITS.maxContent),
    channel_id: draft.channel_id,
    scheduled_for: draft.scheduled_for ?? null,
  }
}

// ── Create (save as draft, or create + publish now) ───────────────────────────

export async function createAnnouncement(
  guildId: string,
  draft: AnnouncementDraft,
  mode: 'draft' | 'publish',
): Promise<ActionResult<{ id: string }>> {
  const validationError = validateDraft(draft)
  if (validationError) return { ok: false, error: validationError }

  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const fields = buildDraftFields(draft)
  const authorName = auth.moderator.username ?? auth.moderator.handle ?? null

  // For an immediate publish, preflight the channel BEFORE inserting so a
  // blocked publish never leaves a phantom row.
  if (mode === 'publish') {
    const blocked = await preflightChannel(guildId, fields.channel_id)
    if (blocked) return { ok: false, error: blocked }
  }

  const { data: inserted, error } = await supabase
    .from('announcements')
    .insert({
      guild_id: guildId,
      ...fields,
      status: 'draft',
      author_id: auth.moderator.userId,
      author_name: authorName,
      created_by: auth.moderator.userId,
    })
    .select('id')
    .single()
  if (error || !inserted) {
    return { ok: false, error: `Failed to save announcement: ${error?.message ?? 'unknown error'}` }
  }
  const id = inserted.id as string

  if (mode === 'publish') {
    const result = await finalizePublish(supabase, guildId, id, fields, auth.moderator)
    revalidate(guildId)
    return result.ok ? { ok: true, data: { id } } : result
  }

  revalidate(guildId)
  return { ok: true, data: { id } }
}

// ── Publish an existing draft / retry a failed one ────────────────────────────

export async function publishAnnouncement(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const a = await loadAnnouncement(supabase, guildId, id)
  if (!a) return { ok: false, error: 'Announcement not found.' }
  if (a.status === 'published') return { ok: false, error: 'This announcement is already published.' }

  const blocked = await preflightChannel(guildId, a.channel_id)
  if (blocked) {
    // Record the reason on the row so the UI can show why it can't go out.
    await supabase.from('announcements').update({ status: 'failed', error: blocked, updated_at: new Date().toISOString() }).eq('id', id)
    return { ok: false, error: blocked }
  }

  const result = await finalizePublish(supabase, guildId, id, a, auth.moderator)
  revalidate(guildId)
  return result
}

/**
 * Post to Discord and reconcile the row to its outcome: published (+ message_id,
 * published_at, cleared error) or failed (+ error). Records the audit
 * notification either way. Shared by create-and-publish and publish-draft.
 */
async function finalizePublish(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
  id: string,
  a: { title: string; content: string; channel_id: string },
  moderator: { userId: string; username: string | null; handle: string | null },
): Promise<ActionResult> {
  const posted = await publishToDiscord(a.channel_id, a)
  const nowIso = new Date().toISOString()

  if (!posted.ok) {
    await supabase
      .from('announcements')
      .update({ status: 'failed', error: posted.error, updated_at: nowIso })
      .eq('id', id)
      .eq('guild_id', guildId)
    await recordNotification({
      guildId,
      type: 'announcement_failed',
      title: `Announcement failed: ${a.title}`,
      body: posted.error,
      link: `/dashboard/${guildId}/announcements`,
      actorId: moderator.userId,
      actorName: moderator.username,
      actorUsername: moderator.handle,
      targetId: a.channel_id,
      metadata: { announcement_id: id },
    })
    return { ok: false, error: `Couldn't publish the announcement: ${posted.error}` }
  }

  await supabase
    .from('announcements')
    .update({ status: 'published', message_id: posted.messageId, published_at: nowIso, error: null, updated_at: nowIso })
    .eq('id', id)
    .eq('guild_id', guildId)
  await recordNotification({
    guildId,
    type: 'announcement_published',
    title: `Announcement published: ${a.title}`,
    body: `Posted to <#${a.channel_id}>`,
    link: `/dashboard/${guildId}/announcements`,
    actorId: moderator.userId,
    actorName: moderator.username,
    actorUsername: moderator.handle,
    targetId: a.channel_id,
    metadata: { announcement_id: id, message_id: posted.messageId },
  })
  return { ok: true }
}

// ── Edit a draft / failed announcement ────────────────────────────────────────

export async function updateAnnouncement(
  guildId: string,
  id: string,
  draft: AnnouncementDraft,
): Promise<ActionResult> {
  const validationError = validateDraft(draft)
  if (validationError) return { ok: false, error: validationError }

  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const a = await loadAnnouncement(supabase, guildId, id)
  if (!a) return { ok: false, error: 'Announcement not found.' }
  if (a.status === 'published') return { ok: false, error: 'A published announcement can\'t be edited — duplicate it instead.' }

  const { error } = await supabase
    .from('announcements')
    .update({ ...buildDraftFields(draft), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to save: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}

// ── Duplicate / repost (always lands as a fresh draft) ────────────────────────

export async function duplicateAnnouncement(
  guildId: string,
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const a = await loadAnnouncement(supabase, guildId, id)
  if (!a) return { ok: false, error: 'Announcement not found.' }

  const { data: inserted, error } = await supabase
    .from('announcements')
    .insert({
      guild_id: guildId,
      title: `${a.title} (copy)`.slice(0, ANNOUNCEMENT_LIMITS.maxTitle),
      content: a.content,
      channel_id: a.channel_id,
      status: 'draft',
      author_id: auth.moderator.userId,
      author_name: auth.moderator.username ?? auth.moderator.handle ?? null,
      created_by: auth.moderator.userId,
    })
    .select('id')
    .single()
  if (error || !inserted) return { ok: false, error: `Failed to duplicate: ${error?.message ?? 'unknown error'}` }

  revalidate(guildId)
  return { ok: true, data: { id: inserted.id as string } }
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Delete an announcement. For a published one we also remove the Discord message
 * (best-effort) so deleting from the dashboard actually retracts it. Records an
 * audit notification.
 */
export async function deleteAnnouncement(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const a = await loadAnnouncement(supabase, guildId, id)
  if (!a) return { ok: false, error: 'Announcement not found.' }

  if (a.status === 'published' && a.message_id) {
    // Best-effort — ignore "unknown message" (already deleted in Discord).
    await deleteChannelMessage(a.channel_id, a.message_id, `Announcement deleted by ${auth.moderator.username ?? 'staff'}`)
  }
  const { error } = await supabase.from('announcements').delete().eq('id', id).eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to delete: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}
