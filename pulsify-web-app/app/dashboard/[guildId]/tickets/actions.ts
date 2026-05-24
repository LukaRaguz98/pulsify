'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import {
  fetchChannelMessages,
  fetchGuildMember,
  postChannelComponents,
  modifyChannel,
  deleteChannel,
  setChannelPermissionOverwrite,
  deleteChannelPermissionOverwrite,
  type V2TopLevelComponent,
  type DiscordMessage,
} from '@/lib/discord'
import {
  normaliseConfig,
  validateConfig,
  hexToInt,
  isHexColor,
  openCustomId,
  SELECT_CUSTOM_ID,
  TICKET_MEMBER_ALLOW,
  TICKET_READONLY_ALLOW,
  TICKET_SEND_DENY,
  PRIORITY_META,
  PRIORITIES,
  type TicketConfig,
  type TicketPriority,
  type TicketEventType,
} from '@/lib/tickets'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/tickets`)
}

type TicketRow = {
  id: string
  guild_id: string
  number: number
  channel_id: string | null
  type_id: string | null
  type_label: string | null
  status: string
  priority: string
  opener_id: string
  opener_name: string | null
  participants: string[]
  opened_at: string
  transcript: string | null
}

async function loadConfig(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
): Promise<TicketConfig> {
  const { data } = await supabase
    .from('ticket_configs')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle()
  return normaliseConfig(guildId, data as Record<string, unknown> | null)
}

async function loadTicket(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
  ticketId: string,
): Promise<TicketRow | null> {
  const { data } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .eq('guild_id', guildId)
    .maybeSingle()
  return (data as TicketRow | null) ?? null
}

/**
 * Post a Components V2 notice into a ticket channel, tinted with the guild's
 * panel accent — so every bot-sent message (dashboard or bot side) is a V2
 * embed in the configured colour. Best-effort.
 */
async function postNotice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
  channelId: string,
  lines: string[],
): Promise<void> {
  const { data } = await supabase.from('ticket_configs').select('panel').eq('guild_id', guildId).maybeSingle()
  const color = (data?.panel as { color?: string } | null)?.color
  const container = {
    type: 17,
    accent_color: hexToInt(isHexColor(color) ? (color as string) : '#5865f2'),
    components: lines.map((l) => ({ type: 10, content: l })),
  }
  await postChannelComponents(channelId, [container] as unknown as V2TopLevelComponent[])
}

/** Append a timeline / audit entry. Best-effort — never blocks the action. */
async function recordEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    ticketId: string
    guildId: string
    type: TicketEventType
    actorId?: string | null
    actorName?: string | null
    detail?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  try {
    await supabase.from('ticket_events').insert({
      ticket_id: input.ticketId,
      guild_id: input.guildId,
      type: input.type,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
      detail: input.detail ? String(input.detail).slice(0, 1000) : null,
      metadata: input.metadata ?? {},
    })
  } catch (e) {
    console.error('[tickets] event insert threw', e)
  }
}

// ── Configuration ─────────────────────────────────────────────────────────────

export async function saveTicketConfig(
  guildId: string,
  draft: TicketConfig,
): Promise<ActionResult> {
  const config = normaliseConfig(guildId, draft as unknown as Record<string, unknown>)
  const validationError = validateConfig(config)
  if (validationError) return { ok: false, error: validationError }

  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  // Never let a settings save rewind the monotonic ticket counter.
  const { data: existing } = await supabase
    .from('ticket_configs')
    .select('ticket_counter')
    .eq('guild_id', guildId)
    .maybeSingle()
  const counter = Math.max(config.ticket_counter, (existing?.ticket_counter as number) ?? 0)

  const { error } = await supabase.from('ticket_configs').upsert(
    {
      guild_id: guildId,
      enabled: config.enabled,
      panel: config.panel,
      ticket_types: config.ticket_types,
      category_id: config.category_id,
      support_role_ids: config.support_role_ids,
      transcript_channel_id: config.transcript_channel_id,
      log_channel_id: config.log_channel_id,
      naming_format: config.naming_format,
      opening_message: config.opening_message,
      auto_close: config.auto_close,
      per_user_limit: config.per_user_limit,
      ping_support: config.ping_support,
      ticket_counter: counter,
      updated_at: new Date().toISOString(),
      updated_by: auth.moderator.userId,
    },
    { onConflict: 'guild_id' },
  )
  if (error) return { ok: false, error: `Failed to save settings: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}

/**
 * Post (or re-post) the ticket panel into its configured channel. The buttons /
 * dropdown carry custom_ids the bot listens for, so a click opens a ticket. We
 * build a Components V2 container so it matches the look of the app's other
 * embeds.
 */
export async function postTicketPanel(guildId: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const config = await loadConfig(supabase, guildId)
  const { panel } = config
  if (!panel.channel_id) return { ok: false, error: 'Pick a channel for the panel first.' }

  const enabledTypes = config.ticket_types.filter((t) => t.enabled)
  if (enabledTypes.length === 0) return { ok: false, error: 'Enable at least one ticket type first.' }

  const accent = hexToInt(panel.color)
  const container: Record<string, unknown> = {
    type: 17,
    accent_color: accent,
    components: [
      { type: 10, content: `# ${panel.title}` },
      { type: 10, content: panel.description },
      { type: 14, divider: true, spacing: 1 },
    ],
  }
  const body = container.components as unknown[]

  if (panel.mode === 'dropdown') {
    body.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: SELECT_CUSTOM_ID,
          placeholder: 'Choose a ticket type…',
          options: enabledTypes.map((t) => ({
            label: t.label,
            value: t.id,
            description: t.description?.slice(0, 100),
            emoji: t.emoji ? { name: t.emoji } : undefined,
          })),
        },
      ],
    })
  } else {
    body.push({
      type: 1,
      components: enabledTypes.slice(0, 5).map((t) => ({
        type: 2,
        style: 2,
        label: t.label.slice(0, 80),
        custom_id: openCustomId(t.id),
        emoji: t.emoji ? { name: t.emoji } : undefined,
      })),
    })
  }

  const res = await postChannelComponents(
    panel.channel_id,
    [container] as unknown as V2TopLevelComponent[],
  )
  if (!res.ok) return { ok: false, error: res.error }

  await recordNotification({
    guildId,
    type: 'ticket_updated',
    severity: 'info',
    title: 'Ticket panel posted',
    body: `Members can now open tickets from <#${panel.channel_id}>.`,
    link: `/dashboard/${guildId}/tickets`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: panel.channel_id,
  })
  revalidate(guildId)
  return { ok: true }
}

// ── Claim / assign ────────────────────────────────────────────────────────────

export async function claimTicket(guildId: string, ticketId: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const ticket = await loadTicket(supabase, guildId, ticketId)
  if (!ticket) return { ok: false, error: 'Ticket not found.' }
  if (ticket.status === 'closed') return { ok: false, error: 'This ticket is closed.' }

  const name = auth.moderator.username ?? auth.moderator.handle ?? 'A staff member'
  await supabase
    .from('tickets')
    .update({ claimed_by: auth.moderator.userId, claimed_by_name: name, status: 'claimed', updated_at: new Date().toISOString() })
    .eq('id', ticketId)
    .eq('guild_id', guildId)

  await recordEvent(supabase, {
    ticketId, guildId, type: 'claimed', actorId: auth.moderator.userId, actorName: name,
  })
  if (ticket.channel_id) {
    await postNotice(supabase, guildId, ticket.channel_id, [`🙌 **${name}** claimed this ticket.`])
  }
  revalidate(guildId)
  return { ok: true }
}

export async function unclaimTicket(guildId: string, ticketId: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const ticket = await loadTicket(supabase, guildId, ticketId)
  if (!ticket) return { ok: false, error: 'Ticket not found.' }
  if (ticket.status === 'closed') return { ok: false, error: 'This ticket is closed.' }

  await supabase
    .from('tickets')
    .update({ claimed_by: null, claimed_by_name: null, status: 'open', updated_at: new Date().toISOString() })
    .eq('id', ticketId)
    .eq('guild_id', guildId)
  await recordEvent(supabase, {
    ticketId, guildId, type: 'unclaimed', actorId: auth.moderator.userId, actorName: auth.moderator.username,
  })
  revalidate(guildId)
  return { ok: true }
}

/** Assign a ticket to a specific staff member (by Discord user id). */
export async function assignTicket(
  guildId: string,
  ticketId: string,
  userId: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const cleanId = userId.trim()
  if (!/^\d{15,21}$/.test(cleanId)) return { ok: false, error: 'Enter a valid Discord user ID.' }

  const supabase = await createClient()
  const ticket = await loadTicket(supabase, guildId, ticketId)
  if (!ticket) return { ok: false, error: 'Ticket not found.' }
  if (ticket.status === 'closed') return { ok: false, error: 'This ticket is closed.' }

  const member = await fetchGuildMember(guildId, cleanId)
  if (!member) return { ok: false, error: 'That member is not in this server.' }
  const name = member.nick ?? member.user.global_name ?? member.user.username

  await supabase
    .from('tickets')
    .update({ claimed_by: cleanId, claimed_by_name: name, status: 'claimed', updated_at: new Date().toISOString() })
    .eq('id', ticketId)
    .eq('guild_id', guildId)
  await recordEvent(supabase, {
    ticketId, guildId, type: 'assigned', actorId: auth.moderator.userId, actorName: auth.moderator.username,
    detail: `Assigned to ${name}`,
  })
  if (ticket.channel_id) {
    await postNotice(supabase, guildId, ticket.channel_id, [`📌 This ticket was assigned to <@${cleanId}>.`])
  }
  revalidate(guildId)
  return { ok: true }
}

export async function setTicketPriority(
  guildId: string,
  ticketId: string,
  priority: TicketPriority,
): Promise<ActionResult> {
  if (!PRIORITIES.includes(priority)) return { ok: false, error: 'Invalid priority.' }
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const ticket = await loadTicket(supabase, guildId, ticketId)
  if (!ticket) return { ok: false, error: 'Ticket not found.' }

  await supabase
    .from('tickets')
    .update({ priority, updated_at: new Date().toISOString() })
    .eq('id', ticketId)
    .eq('guild_id', guildId)
  await recordEvent(supabase, {
    ticketId, guildId, type: 'priority_changed', actorId: auth.moderator.userId, actorName: auth.moderator.username,
    detail: `→ ${PRIORITY_META[priority].label}`,
  })
  revalidate(guildId)
  return { ok: true }
}

/** Internal staff note — stored on the timeline, never posted to Discord. */
export async function addTicketNote(
  guildId: string,
  ticketId: string,
  note: string,
): Promise<ActionResult> {
  const body = note.trim()
  if (!body) return { ok: false, error: 'Note cannot be empty.' }
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const ticket = await loadTicket(supabase, guildId, ticketId)
  if (!ticket) return { ok: false, error: 'Ticket not found.' }

  await recordEvent(supabase, {
    ticketId, guildId, type: 'note', actorId: auth.moderator.userId,
    actorName: auth.moderator.username, detail: body.slice(0, 1000),
  })
  revalidate(guildId)
  return { ok: true }
}

// ── Channel management ──────────────────────────────────────────────────────

export async function renameTicketChannel(
  guildId: string,
  ticketId: string,
  name: string,
): Promise<ActionResult> {
  const clean = name.trim()
  if (!clean) return { ok: false, error: 'Enter a channel name.' }
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const ticket = await loadTicket(supabase, guildId, ticketId)
  if (!ticket) return { ok: false, error: 'Ticket not found.' }
  if (!ticket.channel_id) return { ok: false, error: 'This ticket has no Discord channel.' }

  const res = await modifyChannel(ticket.channel_id, { name: clean }, 0, `Ticket renamed by ${auth.moderator.username ?? 'staff'}`)
  if (!res.ok) return { ok: false, error: res.error }

  await recordEvent(supabase, {
    ticketId, guildId, type: 'renamed', actorId: auth.moderator.userId,
    actorName: auth.moderator.username, detail: `→ #${res.channel.name}`,
  })
  revalidate(guildId)
  return { ok: true }
}

export async function addTicketUser(
  guildId: string,
  ticketId: string,
  userId: string,
): Promise<ActionResult> {
  const cleanId = userId.trim()
  if (!/^\d{15,21}$/.test(cleanId)) return { ok: false, error: 'Enter a valid Discord user ID.' }
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const ticket = await loadTicket(supabase, guildId, ticketId)
  if (!ticket) return { ok: false, error: 'Ticket not found.' }
  if (!ticket.channel_id) return { ok: false, error: 'This ticket has no Discord channel.' }

  const member = await fetchGuildMember(guildId, cleanId)
  if (!member) return { ok: false, error: 'That member is not in this server.' }

  const res = await setChannelPermissionOverwrite(
    ticket.channel_id,
    cleanId,
    { type: 1, allow: TICKET_MEMBER_ALLOW, deny: '0' },
    `Added to ticket by ${auth.moderator.username ?? 'staff'}`,
  )
  if (!res.ok) return { ok: false, error: res.error }

  const participants = Array.from(new Set([...(ticket.participants ?? []), cleanId]))
  await supabase.from('tickets').update({ participants, updated_at: new Date().toISOString() }).eq('id', ticketId).eq('guild_id', guildId)
  await recordEvent(supabase, {
    ticketId, guildId, type: 'user_added', actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    detail: `Added ${member.user.global_name ?? member.user.username}`,
  })
  await postNotice(supabase, guildId, ticket.channel_id, [`➕ <@${cleanId}> was added to the ticket.`])
  revalidate(guildId)
  return { ok: true }
}

export async function removeTicketUser(
  guildId: string,
  ticketId: string,
  userId: string,
): Promise<ActionResult> {
  const cleanId = userId.trim()
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const ticket = await loadTicket(supabase, guildId, ticketId)
  if (!ticket) return { ok: false, error: 'Ticket not found.' }
  if (!ticket.channel_id) return { ok: false, error: 'This ticket has no Discord channel.' }

  const res = await deleteChannelPermissionOverwrite(ticket.channel_id, cleanId, `Removed from ticket by ${auth.moderator.username ?? 'staff'}`)
  if (!res.ok) return { ok: false, error: res.error }

  const participants = (ticket.participants ?? []).filter((p) => p !== cleanId)
  await supabase.from('tickets').update({ participants, updated_at: new Date().toISOString() }).eq('id', ticketId).eq('guild_id', guildId)
  await recordEvent(supabase, {
    ticketId, guildId, type: 'user_removed', actorId: auth.moderator.userId, actorName: auth.moderator.username,
    detail: `Removed <@${cleanId}>`,
  })
  revalidate(guildId)
  return { ok: true }
}

// ── Close / reopen / delete ────────────────────────────────────────────────

function buildTranscript(messages: DiscordMessage[], ticket: { number: number; type_label: string | null; opener_name: string | null; opener_id: string; opened_at: string }): string {
  const header =
    `Transcript — Ticket #${ticket.number} (${ticket.type_label ?? 'Ticket'})\n` +
    `Opened by ${ticket.opener_name ?? ticket.opener_id} on ${new Date(ticket.opened_at).toISOString()}\n` +
    `Generated ${new Date().toISOString()}\n${'─'.repeat(48)}\n`
  // Discord returns newest-first — reverse to read top-to-bottom.
  const lines = [...messages].reverse().map((m) => {
    const ts = new Date(m.timestamp).toISOString().replace('T', ' ').slice(0, 19)
    const author = m.author.global_name ?? m.author.username
    const att = m.attachments?.length ? ' ' + m.attachments.map((a) => `[file: ${a.filename}]`).join(' ') : ''
    return `[${ts}] ${author}: ${m.content || ''}${att}`.trim()
  })
  return header + lines.join('\n')
}

export async function closeTicket(
  guildId: string,
  ticketId: string,
  reason: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const ticket = await loadTicket(supabase, guildId, ticketId)
  if (!ticket) return { ok: false, error: 'Ticket not found.' }
  if (ticket.status === 'closed') return { ok: false, error: 'This ticket is already closed.' }

  // Capture a transcript from the channel's message history before locking it.
  let transcript = ticket.transcript
  if (ticket.channel_id) {
    const messages = await fetchChannelMessages(ticket.channel_id, 100)
    if (messages.length > 0) transcript = buildTranscript(messages, ticket)
  }

  const closeReason = reason.trim() || null
  await supabase
    .from('tickets')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: auth.moderator.userId,
      closed_by_name: auth.moderator.username,
      close_reason: closeReason,
      transcript,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ticketId)
    .eq('guild_id', guildId)

  // A V2 container builder tinted with the configured panel accent — used for
  // both the in-channel close notice and the transcript-channel summary.
  const config = await loadConfig(supabase, guildId)
  const accent = hexToInt(config.panel.color)
  const v2 = (lines: string[]) =>
    [{ type: 17, accent_color: accent, components: lines.map((l) => ({ type: 10, content: l })) }] as unknown as V2TopLevelComponent[]

  // Lock the channel: opener keeps read access, loses the ability to post.
  if (ticket.channel_id) {
    await setChannelPermissionOverwrite(
      ticket.channel_id,
      ticket.opener_id,
      { type: 1, allow: TICKET_READONLY_ALLOW, deny: TICKET_SEND_DENY },
      'Ticket closed',
    )
    await postChannelComponents(
      ticket.channel_id,
      v2([`🔒 Ticket closed by ${auth.moderator.username ?? 'staff'}${closeReason ? ` — ${closeReason}` : ''}.`]),
    )
  }

  // Mirror a summary to the transcript channel, if configured.
  if (config.transcript_channel_id) {
    await postChannelComponents(
      config.transcript_channel_id,
      v2([
        `# Ticket #${ticket.number} closed`,
        `**Type:** ${ticket.type_label ?? 'Ticket'}\n` +
          `**Opened by:** ${ticket.opener_name ?? `<@${ticket.opener_id}>`}\n` +
          `**Closed by:** ${auth.moderator.username ?? 'staff'}` +
          (closeReason ? `\n**Reason:** ${closeReason}` : ''),
        `-# Full transcript is available on the Pulsify dashboard.`,
      ]),
    )
  }

  await recordEvent(supabase, {
    ticketId, guildId, type: 'closed', actorId: auth.moderator.userId,
    actorName: auth.moderator.username, detail: closeReason,
  })
  await recordNotification({
    guildId,
    type: 'ticket_closed',
    title: `Ticket #${ticket.number} closed`,
    body: closeReason ?? undefined,
    link: `/dashboard/${guildId}/tickets`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    metadata: { ticket_id: ticketId, type: ticket.type_id },
  })
  revalidate(guildId)
  return { ok: true }
}

export async function reopenTicket(guildId: string, ticketId: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const ticket = await loadTicket(supabase, guildId, ticketId)
  if (!ticket) return { ok: false, error: 'Ticket not found.' }
  if (ticket.status !== 'closed') return { ok: false, error: 'This ticket is not closed.' }

  await supabase
    .from('tickets')
    .update({
      status: 'open', closed_at: null, closed_by: null, closed_by_name: null, close_reason: null,
      last_activity_at: new Date().toISOString(), inactivity_warned_at: null, updated_at: new Date().toISOString(),
    })
    .eq('id', ticketId)
    .eq('guild_id', guildId)

  if (ticket.channel_id) {
    await setChannelPermissionOverwrite(
      ticket.channel_id,
      ticket.opener_id,
      { type: 1, allow: TICKET_MEMBER_ALLOW, deny: '0' },
      'Ticket reopened',
    )
    await postNotice(supabase, guildId, ticket.channel_id, [`🔓 Ticket reopened by ${auth.moderator.username ?? 'staff'}.`])
  }
  await recordEvent(supabase, {
    ticketId, guildId, type: 'reopened', actorId: auth.moderator.userId, actorName: auth.moderator.username,
  })
  revalidate(guildId)
  return { ok: true }
}

/** Permanently delete the ticket: removes the Discord channel + the DB record. */
export async function deleteTicket(guildId: string, ticketId: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const ticket = await loadTicket(supabase, guildId, ticketId)
  if (!ticket) return { ok: false, error: 'Ticket not found.' }

  if (ticket.channel_id) {
    const res = await deleteChannel(ticket.channel_id, `Ticket deleted by ${auth.moderator.username ?? 'staff'}`)
    // Ignore "unknown channel" (already gone); surface other failures.
    if (!res.ok && !/unknown channel/i.test(res.error)) return { ok: false, error: res.error }
  }
  await supabase.from('ticket_events').delete().eq('ticket_id', ticketId).eq('guild_id', guildId)
  await supabase.from('tickets').delete().eq('id', ticketId).eq('guild_id', guildId)

  await recordNotification({
    guildId,
    type: 'ticket_updated',
    severity: 'warning',
    title: `Ticket #${ticket.number} deleted`,
    link: `/dashboard/${guildId}/tickets`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
  })
  revalidate(guildId)
  return { ok: true }
}

// ── Read: timeline (lighter auth — read-only, can be hit on every detail open) ──

export async function getTicketEvents(
  guildId: string,
  ticketId: string,
): Promise<ActionResult<{ events: { id: number; ticket_id: string; type: TicketEventType; actor_id: string | null; actor_name: string | null; detail: string | null; created_at: string }[] }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'You must be signed in.' }

  const { data, error } = await supabase
    .from('ticket_events')
    .select('id, ticket_id, type, actor_id, actor_name, detail, created_at')
    .eq('guild_id', guildId)
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: { events: (data ?? []) as never } }
}

/** Fetch the stored transcript text for download. */
export async function getTicketTranscript(
  guildId: string,
  ticketId: string,
): Promise<ActionResult<{ transcript: string | null }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'You must be signed in.' }
  const { data, error } = await supabase
    .from('tickets')
    .select('transcript')
    .eq('id', ticketId)
    .eq('guild_id', guildId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: { transcript: (data?.transcript as string | null) ?? null } }
}
