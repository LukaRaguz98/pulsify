'use server'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import {
  postChannelComponentsReturningId,
  editChannelComponents,
  deleteChannelMessage,
  type V2TopLevelComponent,
  type V2Attachment,
} from '@/lib/discord'
import {
  validateDraft,
  normaliseRequirements,
  hasRequirements,
  describeRequirements,
  GIVEAWAY_LIMITS,
  type GiveawayDraft,
  type GiveawayRequirements,
} from '@/lib/giveaways'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

const BRAND = 0x8b5cf6
const GREY = 0x94a3b8

// Pulse giveaway badge — attached as a header thumbnail on the embed the
// dashboard posts, identical bytes to the copy the bot ships so a giveaway
// looks the same whoever posted it. Edits (entry count, settled state) omit the
// attachments field and so preserve it. Loaded once; absent ⇒ plain heading.
const ICON_NAME = 'pulse-giveaway.png'
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
  revalidatePath(`/dashboard/${guildId}/giveaways`)
}

type GiveawayRow = {
  id: string
  guild_id: string
  title: string
  description: string | null
  prize: string
  channel_id: string
  message_id: string | null
  winner_count: number
  status: string
  requirements: GiveawayRequirements
  blacklist_user_ids: string[]
  starts_at: string | null
  ends_at: string
  entry_count: number
  host_id: string | null
  host_name: string | null
}

async function loadGiveaway(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
  id: string,
): Promise<GiveawayRow | null> {
  const { data } = await supabase
    .from('giveaways')
    .select('*')
    .eq('id', id)
    .eq('guild_id', guildId)
    .maybeSingle()
  return (data as GiveawayRow | null) ?? null
}

// ── Discord embed (MUST match pulse-bot/src/giveaways.js activeContainer) ─────

const td = (content: string) => ({ type: 10, content })

// Flavour line under the title when no description is set — keeps the header
// from looking empty beside the badge. Mirror of JOIN_BLURB in giveaways.js.
const JOIN_BLURB = 'Click **Join Giveaway** below for your chance to win!'

// Header block(s): title heading + a short subtitle sitting beside the giveaway
// badge thumbnail (type-9 Section), so the top of the embed stays filled.
// Returns an array (callers spread it). Mirror of headerBlocks() in giveaways.js.
function headerBlocks(title: string, subtitle?: string | null): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [td('**Pulse**'), td(`# ${title}`)]
  if (subtitle) lines.push(td(`-# ${subtitle}`))
  if (!HAS_ICON) return lines
  return [
    {
      type: 9,
      components: lines,
      accessory: { type: 11, media: { url: `attachment://${ICON_NAME}` }, description: 'Pulse giveaway' },
    },
  ]
}

function activeContainer(g: {
  id: string
  title: string
  description: string | null
  prize: string
  winner_count: number
  ends_at: string
  entry_count: number
  host_id: string | null
  host_name: string | null
  requirements: GiveawayRequirements
}): V2TopLevelComponent {
  const req = g.requirements
  const endUnix = Math.floor(new Date(g.ends_at).getTime() / 1000)
  // No literal 🎉 prefix — preset titles already carry one and the badge brands
  // the embed. Description (or a fallback blurb) rides in the header beside the
  // badge so the top isn't half-empty; requirements collapse to one · line.
  const subtitle = g.description ? g.description.slice(0, 1500) : JOIN_BLURB
  const body: Record<string, unknown>[] = [...headerBlocks(g.title, subtitle)]
  body.push(
    td(
      `**Prize:** ${g.prize}\n` +
        `**Winners:** ${g.winner_count}\n` +
        `**Ends:** <t:${endUnix}:R> (<t:${endUnix}:f>)`,
    ),
  )
  if (hasRequirements(req)) {
    // Role mentions (<@&id>) so Discord renders names — matches the bot's embed.
    const summary = describeRequirements(req, (id) => `<@&${id}>`).join(' · ')
    body.push(td(`-# **Requirements:** ${summary}`))
  }
  if (g.host_id || g.host_name) body.push(td(`-# Hosted by ${g.host_id ? `<@${g.host_id}>` : g.host_name}`))
  body.push({ type: 14, divider: true, spacing: 1 })
  body.push({
    type: 1,
    components: [
      { type: 2, style: 1, label: 'Join Giveaway', emoji: { name: '🎉' }, custom_id: `gw:join:${g.id}` },
      {
        type: 2,
        style: 2,
        label: `${g.entry_count} ${g.entry_count === 1 ? 'entry' : 'entries'}`,
        custom_id: `gw:count:${g.id}`,
        disabled: true,
      },
    ],
  })
  body.push(td('-# Pulse · Giveaway'))
  return { type: 17, accent_color: BRAND, components: body } as unknown as V2TopLevelComponent
}

function cancelledContainer(g: { title: string; description: string | null; prize: string }): V2TopLevelComponent {
  // Mirrors giveaways.js endedContainer (cancelled branch): prize in the header
  // beside the badge, description below, then the cancelled notice.
  const body: Record<string, unknown>[] = [...headerBlocks(g.title, `**Prize:** ${g.prize}`)]
  if (g.description) body.push(td(g.description.slice(0, 1500)))
  body.push({ type: 14, divider: true, spacing: 1 })
  body.push(td('This giveaway was cancelled.'))
  body.push(td('-# Pulse · Giveaway cancelled'))
  return { type: 17, accent_color: GREY, components: body } as unknown as V2TopLevelComponent
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createGiveaway(
  guildId: string,
  draft: GiveawayDraft,
): Promise<ActionResult<{ id: string }>> {
  const validationError = validateDraft(draft)
  if (validationError) return { ok: false, error: validationError }

  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const requirements = normaliseRequirements(draft.requirements)
  const blacklist = draft.blacklist_user_ids
    .filter((id) => /^\d{15,21}$/.test(id))
    .slice(0, GIVEAWAY_LIMITS.maxBlacklist)

  const now = Date.now()
  const startDelayMs = Math.max(0, draft.start_delay_minutes) * 60_000
  const startsAt = startDelayMs > 0 ? new Date(now + startDelayMs) : null
  const endsAt = new Date((startsAt?.getTime() ?? now) + draft.duration_minutes * 60_000)
  const scheduled = startsAt !== null
  const hostName = auth.moderator.username ?? auth.moderator.handle ?? null

  const insert = {
    guild_id: guildId,
    title: draft.title.trim().slice(0, GIVEAWAY_LIMITS.maxTitle),
    description: draft.description.trim().slice(0, GIVEAWAY_LIMITS.maxDescription) || null,
    prize: draft.prize.trim().slice(0, GIVEAWAY_LIMITS.maxPrize),
    channel_id: draft.channel_id,
    winner_count: Math.max(1, Math.min(GIVEAWAY_LIMITS.maxWinners, draft.winner_count)),
    status: scheduled ? 'scheduled' : 'active',
    requirements,
    blacklist_user_ids: blacklist,
    starts_at: startsAt?.toISOString() ?? null,
    ends_at: endsAt.toISOString(),
    entry_count: 0,
    host_id: auth.moderator.userId,
    host_name: hostName,
    created_by: auth.moderator.userId,
  }

  const { data: inserted, error } = await supabase.from('giveaways').insert(insert).select('id').single()
  if (error || !inserted) {
    return { ok: false, error: `Failed to create giveaway: ${error?.message ?? 'unknown error'}` }
  }
  const id = inserted.id as string

  // Post the message right away for immediate giveaways. Scheduled ones are
  // posted by the bot when their start time arrives.
  if (!scheduled) {
    const res = await postChannelComponentsReturningId(
      draft.channel_id,
      [activeContainer({ ...insert, id, host_name: hostName })],
      iconAttachments(),
    )
    if (res.ok) {
      await supabase.from('giveaways').update({ message_id: res.messageId }).eq('id', id)
    } else {
      // Roll back so we don't leave a phantom active giveaway with no message.
      await supabase.from('giveaways').delete().eq('id', id)
      return { ok: false, error: `Couldn't post the giveaway: ${res.error}` }
    }
  }

  await recordNotification({
    guildId,
    type: 'giveaway_started',
    severity: scheduled ? 'info' : 'success',
    title: scheduled ? `Giveaway scheduled: ${insert.title}` : `Giveaway started: ${insert.title}`,
    body: `Prize: ${insert.prize}`,
    link: `/dashboard/${guildId}/giveaways`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: draft.channel_id,
    metadata: { giveaway_id: id },
  })

  revalidate(guildId)
  return { ok: true, data: { id } }
}

// ── Edit (title / prize / details / requirements while scheduled or active) ──

export async function updateGiveaway(
  guildId: string,
  id: string,
  patch: {
    title: string
    description: string
    prize: string
    winner_count: number
    requirements: GiveawayRequirements
    blacklist_user_ids: string[]
  },
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  if (!patch.title.trim()) return { ok: false, error: 'Give your giveaway a title.' }
  if (!patch.prize.trim()) return { ok: false, error: 'Describe the prize.' }

  const supabase = await createClient()
  const g = await loadGiveaway(supabase, guildId, id)
  if (!g) return { ok: false, error: 'Giveaway not found.' }
  if (g.status === 'ended' || g.status === 'cancelled') {
    return { ok: false, error: 'You can only edit a scheduled or active giveaway.' }
  }

  const requirements = normaliseRequirements(patch.requirements)
  const blacklist = patch.blacklist_user_ids.filter((u) => /^\d{15,21}$/.test(u)).slice(0, GIVEAWAY_LIMITS.maxBlacklist)
  const update = {
    title: patch.title.trim().slice(0, GIVEAWAY_LIMITS.maxTitle),
    description: patch.description.trim().slice(0, GIVEAWAY_LIMITS.maxDescription) || null,
    prize: patch.prize.trim().slice(0, GIVEAWAY_LIMITS.maxPrize),
    winner_count: Math.max(1, Math.min(GIVEAWAY_LIMITS.maxWinners, patch.winner_count)),
    requirements,
    blacklist_user_ids: blacklist,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('giveaways').update(update).eq('id', id).eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to save: ${error.message}` }

  // Re-render the live message if one is already posted.
  if (g.message_id && g.status === 'active') {
    await editChannelComponents(g.channel_id, g.message_id, [
      activeContainer({ ...g, ...update, id, host_name: g.host_name }),
    ])
  }

  revalidate(guildId)
  return { ok: true }
}

// ── End now / reroll (bot performs the draw — single source of truth) ─────────

/**
 * Ask the bot to draw winners now. Sets `ends_at` to now (so an active giveaway
 * is "over") and bumps `draw_requested_at`; the bot watches that column over
 * realtime and runs the draw + winner announcement immediately. Keeping the
 * winner-pick in the bot avoids two drawers racing to pick winners.
 */
export async function endGiveawayNow(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const g = await loadGiveaway(supabase, guildId, id)
  if (!g) return { ok: false, error: 'Giveaway not found.' }
  if (g.status === 'scheduled') return { ok: false, error: 'This giveaway hasn\'t started yet — cancel it instead.' }
  if (g.status !== 'active') return { ok: false, error: 'This giveaway is not active.' }

  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from('giveaways')
    .update({ ends_at: nowIso, draw_requested_at: nowIso, updated_at: nowIso })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: error.message }
  revalidate(guildId)
  return { ok: true }
}

/** Reroll an ended giveaway — the bot draws new winners excluding the old ones. */
export async function rerollGiveaway(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const g = await loadGiveaway(supabase, guildId, id)
  if (!g) return { ok: false, error: 'Giveaway not found.' }
  if (g.status !== 'ended') return { ok: false, error: 'You can only reroll a giveaway that has ended.' }

  const { error } = await supabase
    .from('giveaways')
    .update({ draw_requested_at: new Date().toISOString() })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: error.message }
  revalidate(guildId)
  return { ok: true }
}

// ── Cancel / delete ───────────────────────────────────────────────────────────

export async function cancelGiveaway(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const g = await loadGiveaway(supabase, guildId, id)
  if (!g) return { ok: false, error: 'Giveaway not found.' }
  if (g.status === 'ended' || g.status === 'cancelled') {
    return { ok: false, error: 'This giveaway is already finished.' }
  }

  await supabase
    .from('giveaways')
    .update({ status: 'cancelled', ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('guild_id', guildId)

  // Flip the live message to its cancelled state, if one was posted.
  if (g.message_id) {
    await editChannelComponents(g.channel_id, g.message_id, [
      cancelledContainer({ title: g.title, description: g.description, prize: g.prize }),
    ])
  }

  await recordNotification({
    guildId,
    type: 'giveaway_ended',
    severity: 'warning',
    title: `Giveaway cancelled: ${g.title}`,
    link: `/dashboard/${guildId}/giveaways`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    metadata: { giveaway_id: id },
  })
  revalidate(guildId)
  return { ok: true }
}

/** Permanently remove the giveaway, its entries, and its Discord message. */
export async function deleteGiveaway(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const g = await loadGiveaway(supabase, guildId, id)
  if (!g) return { ok: false, error: 'Giveaway not found.' }

  if (g.message_id) {
    // Best-effort — ignore "unknown message" (already gone).
    await deleteChannelMessage(g.channel_id, g.message_id, `Giveaway deleted by ${auth.moderator.username ?? 'staff'}`)
  }
  await supabase.from('giveaway_entries').delete().eq('giveaway_id', id).eq('guild_id', guildId)
  await supabase.from('giveaways').delete().eq('id', id).eq('guild_id', guildId)

  revalidate(guildId)
  return { ok: true }
}

// ── Read: entrants (lighter auth — read-only, hit on each detail open) ────────

export async function getGiveawayEntries(
  guildId: string,
  id: string,
): Promise<ActionResult<{ entries: { user_id: string; user_name: string | null; entered_at: string; is_winner: boolean }[] }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'You must be signed in.' }

  const { data, error } = await supabase
    .from('giveaway_entries')
    .select('user_id, user_name, entered_at, is_winner')
    .eq('guild_id', guildId)
    .eq('giveaway_id', id)
    .order('entered_at', { ascending: true })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: { entries: (data ?? []) as never } }
}
