'use server'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { readGuildEmbedInt } from '@/lib/embed-color'
import { recordNotification } from '@/lib/notifications-server'
import {
  fetchGuildChannels,
  checkBotPermissions,
  postChannelComponentsReturningId,
  CHANNEL_TYPES,
  type V2TopLevelComponent,
  type V2Attachment,
} from '@/lib/discord'
import {
  providerById,
  validateDraft,
  deriveLabel,
  normaliseIntegration,
  renderTemplate,
  sampleContext,
  notificationDetails,
  notificationLink,
  stripStandaloneUrl,
  TEMPLATE_MAX,
  type Integration,
  type IntegrationDraft,
  type IntegrationProvider,
  type LogLevel,
} from '@/lib/integrations'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

// Pulse brand violet — the accent used across Pulse embeds (changelog,
// announcements). Reused so an integration notification reads as the same family.
const BRAND = 0x8b5cf6

// The Pulse integrations badge, carried as a header thumbnail so the test
// notification reads the same as the bot's live deliveries (which attach the
// same asset). Loaded once; absent ⇒ the header renders without a badge.
const ICON_NAME = 'pulse-integrations.png'
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
  revalidatePath(`/dashboard/${guildId}/integrations`)
}

// ── Discord embed (Pulse v2, mirrors the announcements container) ─────────────

const td = (content: string) => ({ type: 10, content })
const divider = () => ({ type: 14, divider: true, spacing: 1 })
// Braille-blank run pins the embed to a comfortable width (same trick as the
// announcements container) so short notifications don't render cramped.
const WIDTH_SPACER = td(`-# ${'⠀'.repeat(40)}`)

/**
 * Build the integration notification container — the rich Pulse v2 layout shared
 * with the bot's live deliveries (pulse-bot/src/integrations.js). `accent` is the
 * GUILD's accent (guild_settings.embed_color, set in Server Settings), like every
 * other Pulse embed — the provider is already named in the header, so it doesn't
 * need a colour of its own. Top to bottom:
 * a `Pulse` label + integration heading + `-# <Provider> — Integration` subtitle
 * beside the Pulse badge, a width spacer, a `-# <when>` timestamp chip, the
 * rendered body (with the now-redundant raw URL line stripped), a divider, a
 * labeled details block, a source-link button, and the `Pulse — Integrations`
 * footer. Accent is the provider's brand colour so each service reads distinctly.
 */
function notificationContainer(
  provider: IntegrationProvider,
  label: string,
  body: string,
  ctx: Record<string, string>,
  opts: { isTest?: boolean } = {},
  accent: number = BRAND,
): V2TopLevelComponent {
  const headerLines = [td('**Pulse**'), td(`# ${label}`), td(`-# ${provider.name} — Integration`)]
  const components: Record<string, unknown>[] = []
  if (HAS_ICON) {
    components.push({
      type: 9,
      components: headerLines,
      accessory: { type: 11, media: { url: `attachment://${ICON_NAME}` }, description: 'Pulse integration' },
    })
  } else {
    components.push(...headerLines)
  }
  components.push(WIDTH_SPACER)

  // Timestamp chip — a native Discord relative time so the post reads "just now"
  // and ages on its own. Marked as a test when sent from the dashboard.
  const now = Math.floor(Date.now() / 1000)
  components.push(td(`-# ${opts.isTest ? 'Test notification — ' : ''}<t:${now}:R>`))

  const link = notificationLink(provider.id, ctx)
  const cleanBody = stripStandaloneUrl(body, link?.url).trim()
  for (const para of cleanBody.split(/\n{2,}/)) {
    if (para.trim()) components.push(td(para.trim()))
  }

  const details = notificationDetails(provider.id, ctx)
  if (details.length > 0) {
    components.push(divider())
    components.push(td(details.map((d) => `**${d.label}**  ${d.value}`).join('\n')))
  }

  if (link) {
    components.push({ type: 1, components: [{ type: 2, style: 5, label: link.label, url: link.url }] })
  }

  components.push(divider())
  components.push(td('-# Pulse — Integrations'))
  return { type: 17, accent_color: accent, components } as unknown as V2TopLevelComponent
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function loadIntegration(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
  id: string,
): Promise<Integration | null> {
  const { data } = await supabase
    .from('integrations')
    .select('*')
    .eq('id', id)
    .eq('guild_id', guildId)
    .maybeSingle()
  return data ? normaliseIntegration(data as Record<string, unknown>) : null
}

/** Append a diagnostic log entry. Best-effort — never blocks the action. */
async function recordLog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
  integrationId: string,
  level: LogLevel,
  event: string,
  message?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('integration_logs').insert({
      guild_id: guildId,
      integration_id: integrationId,
      level,
      event,
      message: message ?? null,
      metadata: metadata ?? {},
    })
  } catch (e) {
    console.error('[integrations] log insert failed', e)
  }
}

/**
 * Verify the target channel exists, is a text/announcement channel, and that
 * Pulse can post there. Returns an error string when posting should be blocked,
 * or null when it's safe. Mirrors the announcements preflight.
 */
async function preflightChannel(guildId: string, channelId: string): Promise<string | null> {
  const [channels, perms] = await Promise.all([
    fetchGuildChannels(guildId),
    checkBotPermissions(guildId),
  ])
  const channel = channels.find((c) => c.id === channelId)
  if (!channel) return 'That channel no longer exists. Pick another one.'
  if (channel.type !== CHANNEL_TYPES.TEXT && channel.type !== CHANNEL_TYPES.ANNOUNCEMENT) {
    return 'Notifications can only be posted to a text or announcement channel.'
  }
  if (perms === null) return null // couldn't determine perms — let it try
  if (!perms.inGuild) return 'Pulse is not in this server. Invite it, then try again.'
  if (!perms.administrator && !perms.sendMessages) {
    return "Pulse can't send messages in this server. Grant it the Send Messages permission."
  }
  return null
}

/** Persist-shape from a validated draft (config stays JSON, events folded in). */
function buildFields(provider: IntegrationProvider, draft: IntegrationDraft) {
  const config: Record<string, unknown> = {}
  for (const field of provider.fields) {
    const v = (draft.config[field.key] ?? '').trim()
    if (v) config[field.key] = v
  }
  if (provider.syncEvents?.length) config.events = draft.events
  return {
    provider: provider.id,
    label: draft.label.trim() ? draft.label.trim().slice(0, 80) : deriveLabel(provider, draft.config),
    external_ref: provider.refField ? (draft.config[provider.refField]?.trim() ?? null) : null,
    config,
    channel_id: draft.channel_id,
    template: draft.template?.slice(0, TEMPLATE_MAX) ?? provider.defaultTemplate,
    enabled: draft.enabled,
  }
}

// ── Connect ───────────────────────────────────────────────────────────────────

export async function connectIntegration(
  guildId: string,
  draft: IntegrationDraft,
): Promise<ActionResult<{ id: string }>> {
  const provider = providerById(draft.provider)
  if (!provider) return { ok: false, error: 'Unknown integration.' }

  const validationError = validateDraft(draft)
  if (validationError) return { ok: false, error: validationError }

  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  // If a destination channel was chosen, make sure Pulse can post there before
  // we store a connection that can never deliver.
  if (draft.channel_id) {
    const blocked = await preflightChannel(guildId, draft.channel_id)
    if (blocked) return { ok: false, error: blocked }
  }

  const supabase = await createClient()
  const fields = buildFields(provider, draft)

  // Guard against connecting the exact same resource twice.
  if (fields.external_ref) {
    const { data: dupe } = await supabase
      .from('integrations')
      .select('id')
      .eq('guild_id', guildId)
      .eq('provider', provider.id)
      .eq('external_ref', fields.external_ref)
      .maybeSingle()
    if (dupe) return { ok: false, error: `${provider.name} (${fields.external_ref}) is already connected.` }
  }

  const { data: inserted, error } = await supabase
    .from('integrations')
    .insert({
      guild_id: guildId,
      ...fields,
      status: 'connected',
      last_sync_at: new Date().toISOString(),
      author_id: auth.moderator.userId,
      author_name: auth.moderator.username ?? auth.moderator.handle ?? null,
      created_by: auth.moderator.userId,
    })
    .select('id')
    .single()
  if (error || !inserted) {
    return { ok: false, error: `Failed to connect: ${error?.message ?? 'unknown error'}` }
  }
  const id = inserted.id as string

  await recordLog(supabase, guildId, id, 'success', 'connected', `${provider.name} connected by ${auth.moderator.username ?? 'staff'}.`)
  await recordNotification({
    guildId,
    type: 'integration_connected',
    title: `Integration connected: ${provider.name}`,
    body: fields.label,
    link: `/dashboard/${guildId}/integrations`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    metadata: { integration_id: id, provider: provider.id },
  })

  revalidate(guildId)
  return { ok: true, data: { id } }
}

// ── Update an existing connection's config / notification settings ────────────

export async function updateIntegration(
  guildId: string,
  id: string,
  draft: IntegrationDraft,
): Promise<ActionResult> {
  const provider = providerById(draft.provider)
  if (!provider) return { ok: false, error: 'Unknown integration.' }

  const validationError = validateDraft(draft)
  if (validationError) return { ok: false, error: validationError }

  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  if (draft.channel_id) {
    const blocked = await preflightChannel(guildId, draft.channel_id)
    if (blocked) return { ok: false, error: blocked }
  }

  const supabase = await createClient()
  const existing = await loadIntegration(supabase, guildId, id)
  if (!existing) return { ok: false, error: 'Integration not found.' }

  const fields = buildFields(provider, draft)

  // If the feed target changed (different provider or resource), the stored
  // cursor points at the old feed. Reset it to re-baseline so the worker doesn't
  // backfill the new feed's recent history as a burst of notifications.
  const targetChanged =
    existing.provider !== fields.provider ||
    (existing.external_ref ?? null) !== (fields.external_ref ?? null)
  const patch: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() }
  if (targetChanged) patch.cursor = null

  const { error } = await supabase
    .from('integrations')
    .update(patch)
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to save: ${error.message}` }

  await recordLog(supabase, guildId, id, 'info', 'updated', `Settings updated by ${auth.moderator.username ?? 'staff'}.`)
  revalidate(guildId)
  return { ok: true }
}

// ── Enable / pause notifications (connection stays intact) ────────────────────

export async function setIntegrationEnabled(
  guildId: string,
  id: string,
  enabled: boolean,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase
    .from('integrations')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to update: ${error.message}` }

  await recordLog(supabase, guildId, id, 'info', enabled ? 'resumed' : 'paused', `Notifications ${enabled ? 'resumed' : 'paused'} by ${auth.moderator.username ?? 'staff'}.`)
  revalidate(guildId)
  return { ok: true }
}

// ── Disconnect (keep config) / reconnect ──────────────────────────────────────

export async function disconnectIntegration(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const existing = await loadIntegration(supabase, guildId, id)
  if (!existing) return { ok: false, error: 'Integration not found.' }
  const provider = providerById(existing.provider)

  const { error } = await supabase
    .from('integrations')
    .update({ status: 'disconnected', enabled: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to disconnect: ${error.message}` }

  await recordLog(supabase, guildId, id, 'info', 'disconnected', `Disconnected by ${auth.moderator.username ?? 'staff'}. Configuration kept for reconnecting.`)
  await recordNotification({
    guildId,
    type: 'integration_disconnected',
    title: `Integration disconnected: ${provider?.name ?? existing.provider}`,
    body: existing.label,
    link: `/dashboard/${guildId}/integrations`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    metadata: { integration_id: id, provider: existing.provider },
  })
  revalidate(guildId)
  return { ok: true }
}

export async function reconnectIntegration(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase
    .from('integrations')
    .update({ status: 'connected', enabled: true, last_error: null, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to reconnect: ${error.message}` }

  await recordLog(supabase, guildId, id, 'success', 'connected', `Reconnected by ${auth.moderator.username ?? 'staff'}.`)
  revalidate(guildId)
  return { ok: true }
}

// ── Delete (logs cascade) ──────────────────────────────────────────────────────

export async function deleteIntegration(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase.from('integrations').delete().eq('id', id).eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to remove: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}

// ── Test connection — validates + posts a sample notification to Discord ──────

/**
 * Run a connection test: re-validate the stored config, check Pulse can post to
 * the configured channel, then send a sample notification rendered from the
 * template. Reconciles the row to its outcome (connected + last_sync_at, or
 * error + last_error) and logs the result either way — this is the diagnostic
 * the "Test connection" button drives and the proof notifications reach Discord.
 */
export async function testConnection(guildId: string, id: string): Promise<ActionResult<{ delivered: boolean }>> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const integration = await loadIntegration(supabase, guildId, id)
  if (!integration) return { ok: false, error: 'Integration not found.' }
  const provider = providerById(integration.provider)
  if (!provider) return { ok: false, error: 'Unknown integration.' }

  const nowIso = new Date().toISOString()

  // Re-validate required fields are still present (a token may have been cleared).
  for (const field of provider.fields) {
    if (field.required && !integration.config[field.key]) {
      const reason = `${field.label} is missing — open settings to fix it.`
      await supabase.from('integrations').update({ status: 'error', last_error: reason, updated_at: nowIso }).eq('id', id)
      await recordLog(supabase, guildId, id, 'error', 'test', reason)
      revalidate(guildId)
      return { ok: false, error: reason }
    }
  }

  // No channel yet: the config is valid but there's nowhere to deliver. Treat as
  // a passing config check rather than an error.
  if (!integration.channel_id) {
    await supabase.from('integrations').update({ status: 'connected', last_error: null, last_sync_at: nowIso, updated_at: nowIso }).eq('id', id)
    await recordLog(supabase, guildId, id, 'success', 'test', 'Configuration looks good. Add a notification channel to start delivering.')
    revalidate(guildId)
    return { ok: true, data: { delivered: false } }
  }

  const blocked = await preflightChannel(guildId, integration.channel_id)
  if (blocked) {
    await supabase.from('integrations').update({ status: 'error', last_error: blocked, updated_at: nowIso }).eq('id', id)
    await recordLog(supabase, guildId, id, 'error', 'test', blocked, { channel_id: integration.channel_id })
    revalidate(guildId)
    return { ok: false, error: blocked }
  }

  const config = integration.config as Record<string, string>
  const ctx = sampleContext(provider, config)
  const template = integration.template ?? provider.defaultTemplate
  const body = renderTemplate(template, ctx)

  const posted = await postChannelComponentsReturningId(
    integration.channel_id,
    [notificationContainer(provider, integration.label, body, ctx, { isTest: true }, await readGuildEmbedInt(supabase, guildId))],
    iconAttachments(),
  )

  if (!posted.ok) {
    await supabase.from('integrations').update({ status: 'error', last_error: posted.error, updated_at: nowIso }).eq('id', id)
    await recordLog(supabase, guildId, id, 'error', 'test', posted.error, { channel_id: integration.channel_id })
    await recordNotification({
      guildId,
      type: 'integration_error',
      title: `Integration test failed: ${provider.name}`,
      body: posted.error,
      link: `/dashboard/${guildId}/integrations`,
      actorId: auth.moderator.userId,
      actorName: auth.moderator.username,
      actorUsername: auth.moderator.handle,
      metadata: { integration_id: id, provider: provider.id },
    })
    revalidate(guildId)
    return { ok: false, error: `Couldn't deliver the test: ${posted.error}` }
  }

  await supabase
    .from('integrations')
    .update({ status: 'connected', last_error: null, last_sync_at: nowIso, updated_at: nowIso })
    .eq('id', id)
    .eq('guild_id', guildId)
  // Resolve the channel's human name so the log reads "#general" rather than a
  // raw <#id> mention (which only renders inside Discord, not in the dashboard).
  const channels = await fetchGuildChannels(guildId).catch(() => [])
  const channelName = channels.find((c) => c.id === integration.channel_id)?.name
  const dest = channelName ? `#${channelName}` : 'the channel'
  await recordLog(supabase, guildId, id, 'success', 'notification', `Test notification delivered to ${dest}.`, { message_id: posted.messageId, channel_id: integration.channel_id })
  revalidate(guildId)
  return { ok: true, data: { delivered: true } }
}
