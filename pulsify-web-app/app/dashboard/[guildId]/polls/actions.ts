'use server'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { requireGuildLimit } from '@/lib/billing-server'
import { recordNotification } from '@/lib/notifications-server'
import { readGuildEmbedInt } from '@/lib/embed-color'
import { PULSE_BADGES_ENABLED } from '@/lib/pulse-icon'
import {
  postChannelComponentsReturningId,
  editChannelComponents,
  deleteChannelMessage,
  type V2TopLevelComponent,
  type V2Attachment,
} from '@/lib/discord'
import {
  validateDraft,
  resolveDraftOptions,
  normaliseRequirements,
  normaliseGovernance,
  hasRequirements,
  describeRequirements,
  pollControlsMeta,
  POLL_LIMITS,
  PV,
  BUTTON_OPTION_LIMIT,
  type PollDraft,
  type PollOption,
  type PollRequirements,
  type PollGovernance,
  type PollType,
} from '@/lib/polls'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

// Every poll embed — open or archived — wears the guild accent (Server Settings).
// Mirrors pulse-bot/src/polls.js: no per-state colours, the state is in the text.

// Poll badge — attached as the embed header thumbnail. Falls back to the
// giveaway badge so the embed always has the Pulse mark. Loaded once; absent ⇒
// plain heading. MUST match the bytes the bot ships so a poll looks identical
// whoever posted it.
function loadIcon(): { name: string; buffer: Buffer } | null {
  // Gated on the global Pulse badge switch (see lib/pulse-icon.ts).
  if (!PULSE_BADGES_ENABLED) return null
  for (const name of ['pulse-poll.png', 'pulse-giveaway.png']) {
    try {
      return { name, buffer: readFileSync(path.join(process.cwd(), 'public', name)) }
    } catch {
      /* try next */
    }
  }
  return null
}
const ICON = loadIcon()
const iconAttachments = (): V2Attachment[] | undefined =>
  ICON ? [{ filename: ICON.name, data: ICON.buffer, contentType: 'image/png' }] : undefined

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/polls`)
}

type PollRow = {
  id: string
  guild_id: string
  title: string
  description: string | null
  poll_type: PollType
  options: PollOption[]
  anonymous: boolean
  allow_change: boolean
  max_choices: number
  channel_id: string
  message_id: string | null
  status: string
  requirements: PollRequirements
  governance: PollGovernance
  starts_at: string | null
  ends_at: string | null
  vote_count: number
  voter_count: number
  host_id: string | null
  host_name: string | null
}

async function loadPoll(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
  id: string,
): Promise<PollRow | null> {
  const { data } = await supabase.from('polls').select('*').eq('id', id).eq('guild_id', guildId).maybeSingle()
  return (data as PollRow | null) ?? null
}

// ── Discord embed (MUST match pulse-bot/src/polls.js activeContainer) ─────────

const td = (content: string) => ({ type: 10, content })
const VOTE_BLURB = 'Cast your vote below — your choice is tracked by Pulse.'

function headerBlocks(title: string, subtitle?: string | null): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [td('**Pulse**'), td(`# ${title}`)]
  if (subtitle) lines.push(td(`-# ${subtitle}`))
  if (!ICON) return lines
  return [
    {
      type: 9,
      components: lines,
      accessory: { type: 11, media: { url: `attachment://${ICON.name}` }, description: 'Pulse poll' },
    },
  ]
}

function emojiObj(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined
  const m = /^<a?:(\w+):(\d+)>$/.exec(raw)
  if (m) return { id: m[2], name: m[1] }
  return { name: raw }
}

function voteControls(p: {
  id: string
  poll_type: PollType
  options: PollOption[]
  max_choices: number
}): Record<string, unknown>[] {
  const { multi, max } = pollControlsMeta(p.poll_type, p.options.length, p.max_choices)
  const useButtons = !multi && p.options.length <= BUTTON_OPTION_LIMIT
  if (useButtons) {
    return [
      {
        type: 1,
        components: p.options.map((o) => ({
          type: 2,
          style: p.poll_type === 'yes_no' ? (o.id === 'yes' ? 3 : 4) : 2,
          label: o.label.slice(0, 80),
          ...(o.emoji ? { emoji: emojiObj(o.emoji) } : {}),
          custom_id: `${PV}:vote:${p.id}:${o.id}`,
        })),
      },
    ]
  }
  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `${PV}:select:${p.id}`,
          placeholder: multi ? `Pick up to ${max}` : 'Pick an option',
          min_values: 1,
          max_values: max,
          options: p.options.slice(0, 25).map((o) => ({
            label: o.label.slice(0, 100),
            value: o.id,
            ...(o.emoji ? { emoji: emojiObj(o.emoji) } : {}),
          })),
        },
      ],
    },
  ]
}

function activeContainer(p: {
  id: string
  title: string
  description: string | null
  poll_type: PollType
  options: PollOption[]
  anonymous: boolean
  allow_change: boolean
  max_choices: number
  ends_at: string | null
  vote_count: number
  voter_count: number
  host_id: string | null
  host_name: string | null
  requirements: PollRequirements
  governance: PollGovernance
  accent: number
}): V2TopLevelComponent {
  const req = p.requirements
  const gov = p.governance
  const subtitle = p.description ? p.description.slice(0, 1500) : VOTE_BLURB
  const body: Record<string, unknown>[] = [...headerBlocks(p.title, subtitle)]

  if (p.poll_type !== 'yes_no') {
    body.push(td(p.options.map((o) => `${o.emoji ? `${o.emoji} ` : '• '}${o.label}`).join('\n')))
  }

  const { multi, max } = pollControlsMeta(p.poll_type, p.options.length, p.max_choices)
  const metaBits: string[] = []
  if (multi) metaBits.push(`Pick up to ${max}`)
  if (p.anonymous) metaBits.push('Anonymous')
  if (!p.allow_change) metaBits.push('Votes are final')
  if (metaBits.length) body.push(td(`-# ${metaBits.join(' — ')}`))

  const lines = [`**Votes:** ${p.vote_count}`, `**Voters:** ${p.voter_count}`]
  if (p.ends_at) {
    const endUnix = Math.floor(new Date(p.ends_at).getTime() / 1000)
    lines.push(`**Closes:** <t:${endUnix}:R> (<t:${endUnix}:f>)`)
  } else {
    lines.push('**Closes:** when a moderator closes it')
  }
  body.push(td(lines.join('\n')))

  if (hasRequirements(req)) {
    body.push(td(`-# **Who can vote:** ${describeRequirements(req, (id) => `<@&${id}>`).join(' — ')}`))
  }
  if (gov.weighted) body.push(td(`-# Weighted by ${gov.weight_basis === 'level' ? 'level' : 'reputation'}.`))
  if (p.host_id || p.host_name) body.push(td(`-# Started by ${p.host_id ? `<@${p.host_id}>` : p.host_name}`))

  body.push({ type: 14, divider: true, spacing: 1 })
  for (const row of voteControls(p)) body.push(row)
  body.push(td('-# Pulse — Poll'))
  return { type: 17, accent_color: p.accent, components: body } as unknown as V2TopLevelComponent
}

function archivedContainer(p: { title: string; description: string | null; accent: number }): V2TopLevelComponent {
  const body: Record<string, unknown>[] = [...headerBlocks(p.title, p.description?.slice(0, 1500) ?? null)]
  body.push({ type: 14, divider: true, spacing: 1 })
  body.push(td('This poll was archived.'))
  body.push(td('-# Pulse — Poll archived'))
  return { type: 17, accent_color: p.accent, components: body } as unknown as V2TopLevelComponent
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createPoll(guildId: string, draft: PollDraft): Promise<ActionResult<{ id: string }>> {
  const validationError = validateDraft(draft)
  if (validationError) return { ok: false, error: validationError }

  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()

  // Plan limit (PULSIFY-62): concurrent open polls per guild, gated on the
  // server owner's plan. Only live polls (active + scheduled) count; closed
  // polls never block a new one. Enforced on create only — see audit §6.
  const { count: livePolls } = await supabase
    .from('polls')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .in('status', ['active', 'scheduled'])
  const pollLimit = await requireGuildLimit(guildId, 'maxActivePolls', livePolls ?? 0)
  if (!pollLimit.ok) return { ok: false, error: pollLimit.error }

  const { options, max_choices } = resolveDraftOptions(draft)
  const requirements = normaliseRequirements(draft.requirements)
  const governance = normaliseGovernance(draft.governance)

  const now = Date.now()
  const startDelayMs = Math.max(0, draft.start_delay_minutes) * 60_000
  const startsAt = startDelayMs > 0 ? new Date(now + startDelayMs) : null
  const endsAt =
    draft.duration_minutes > 0 ? new Date((startsAt?.getTime() ?? now) + draft.duration_minutes * 60_000) : null
  const scheduled = startsAt !== null
  const hostName = auth.moderator.username ?? auth.moderator.handle ?? null

  const insert = {
    guild_id: guildId,
    title: draft.title.trim().slice(0, POLL_LIMITS.maxTitle),
    description: draft.description.trim().slice(0, POLL_LIMITS.maxDescription) || null,
    poll_type: draft.poll_type,
    options,
    anonymous: draft.anonymous,
    allow_change: draft.allow_change,
    max_choices,
    channel_id: draft.channel_id,
    status: scheduled ? 'scheduled' : 'active',
    requirements,
    governance,
    starts_at: startsAt?.toISOString() ?? null,
    ends_at: endsAt?.toISOString() ?? null,
    vote_count: 0,
    voter_count: 0,
    host_id: auth.moderator.userId,
    host_name: hostName,
    created_by: auth.moderator.userId,
  }

  const { data: inserted, error } = await supabase.from('polls').insert(insert).select('id').single()
  if (error || !inserted) {
    return { ok: false, error: `Failed to create poll: ${error?.message ?? 'unknown error'}` }
  }
  const id = inserted.id as string

  // Post immediately for non-scheduled polls; the bot posts scheduled ones when
  // their start time arrives.
  if (!scheduled) {
    const res = await postChannelComponentsReturningId(
      draft.channel_id,
      [activeContainer({ ...insert, id, accent: await readGuildEmbedInt(supabase, guildId) })],
      iconAttachments(),
    )
    if (res.ok) {
      await supabase.from('polls').update({ message_id: res.messageId }).eq('id', id)
    } else {
      await supabase.from('polls').delete().eq('id', id)
      return { ok: false, error: `Couldn't post the poll: ${res.error}` }
    }
  }

  await recordNotification({
    guildId,
    type: 'poll_started',
    severity: scheduled ? 'info' : 'success',
    title: scheduled ? `Poll scheduled: ${insert.title}` : `Poll opened: ${insert.title}`,
    link: `/dashboard/${guildId}/polls`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: draft.channel_id,
    metadata: { poll_id: id },
  })

  revalidate(guildId)
  return { ok: true, data: { id } }
}

// ── Edit ──────────────────────────────────────────────────────────────────────

export async function updatePoll(
  guildId: string,
  id: string,
  patch: {
    title: string
    description: string
    options: PollOption[]
    anonymous: boolean
    allow_change: boolean
    max_choices: number
    requirements: PollRequirements
    governance: PollGovernance
  },
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  if (!patch.title.trim()) return { ok: false, error: 'Give your poll a question.' }

  const supabase = await createClient()
  const p = await loadPoll(supabase, guildId, id)
  if (!p) return { ok: false, error: 'Poll not found.' }
  if (p.status === 'closed' || p.status === 'archived') {
    return { ok: false, error: 'You can only edit a scheduled or active poll.' }
  }

  const requirements = normaliseRequirements(patch.requirements)
  const governance = normaliseGovernance(patch.governance)

  const update: Record<string, unknown> = {
    title: patch.title.trim().slice(0, POLL_LIMITS.maxTitle),
    description: patch.description.trim().slice(0, POLL_LIMITS.maxDescription) || null,
    anonymous: patch.anonymous,
    allow_change: patch.allow_change,
    requirements,
    governance,
    updated_at: new Date().toISOString(),
  }

  // Options + max_choices can only change while no vote has been cast yet —
  // otherwise existing tallies would point at options that moved. yes_no/rating
  // options are fixed regardless.
  const optionsEditable = p.poll_type === 'single' || p.poll_type === 'multiple' || p.poll_type === 'feature'
  if (optionsEditable && p.vote_count === 0) {
    const { options, max_choices } = resolveDraftOptions({
      poll_type: p.poll_type,
      options: patch.options,
      rating_scale: POLL_LIMITS.ratingDefault,
      max_choices: patch.max_choices,
    } as PollDraft)
    if (options.length < POLL_LIMITS.minOptions) return { ok: false, error: `Add at least ${POLL_LIMITS.minOptions} options.` }
    update.options = options
    update.max_choices = max_choices
  }

  const { error } = await supabase.from('polls').update(update).eq('id', id).eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to save: ${error.message}` }

  // Re-render the live message if one is posted.
  if (p.message_id && p.status === 'active') {
    const merged = { ...p, ...update } as unknown as PollRow
    await editChannelComponents(p.channel_id, p.message_id, [
      activeContainer({
        id,
        title: merged.title,
        description: merged.description,
        poll_type: p.poll_type,
        options: (update.options as PollOption[]) ?? p.options,
        anonymous: merged.anonymous,
        allow_change: merged.allow_change,
        max_choices: (update.max_choices as number) ?? p.max_choices,
        ends_at: p.ends_at,
        vote_count: p.vote_count,
        voter_count: p.voter_count,
        host_id: p.host_id,
        host_name: p.host_name,
        requirements,
        governance,
        accent: await readGuildEmbedInt(supabase, guildId),
      }),
    ])
  }

  revalidate(guildId)
  return { ok: true }
}

// ── Close now (bot performs the tally — single source of truth) ───────────────

/**
 * Ask the bot to close + tally now. Sets `ends_at` to now and bumps
 * `close_requested_at`; the bot watches that column over realtime and runs the
 * tally + result announcement immediately. Keeping the tally in the bot avoids
 * two closers racing.
 */
export async function closePollNow(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const p = await loadPoll(supabase, guildId, id)
  if (!p) return { ok: false, error: 'Poll not found.' }
  if (p.status === 'scheduled') return { ok: false, error: "This poll hasn't opened yet — delete it instead." }
  if (p.status !== 'active') return { ok: false, error: 'This poll is not active.' }

  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from('polls')
    .update({ ends_at: nowIso, close_requested_at: nowIso, updated_at: nowIso })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: error.message }
  revalidate(guildId)
  return { ok: true }
}

// ── Archive (closed → archived) ────────────────────────────────────────────────

export async function archivePoll(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const p = await loadPoll(supabase, guildId, id)
  if (!p) return { ok: false, error: 'Poll not found.' }
  if (p.status !== 'closed') return { ok: false, error: 'Close the poll before archiving it.' }

  await supabase
    .from('polls')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('guild_id', guildId)

  if (p.message_id) {
    await editChannelComponents(p.channel_id, p.message_id, [
      archivedContainer({
        title: p.title,
        description: p.description,
        accent: await readGuildEmbedInt(supabase, guildId),
      }),
    ])
  }
  revalidate(guildId)
  return { ok: true }
}

// ── Delete ──────────────────────────────────────────────────────────────────

export async function deletePoll(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const p = await loadPoll(supabase, guildId, id)
  if (!p) return { ok: false, error: 'Poll not found.' }

  if (p.message_id) {
    await deleteChannelMessage(p.channel_id, p.message_id, `Poll deleted by ${auth.moderator.username ?? 'staff'}`)
  }
  await supabase.from('poll_votes').delete().eq('poll_id', id).eq('guild_id', guildId)
  await supabase.from('polls').delete().eq('id', id).eq('guild_id', guildId)

  revalidate(guildId)
  return { ok: true }
}

// ── Read: votes (for the detail breakdown) ────────────────────────────────────

export type VoteBreakdownRow = {
  user_id: string | null
  user_name: string | null
  option_id: string
  weight: number
  voted_at: string
}

/**
 * Vote rows for a poll's detail view. Anonymous polls strip voter identity (the
 * data is still aggregated for the breakdown, just without names) so the
 * dashboard honours the same anonymity members were promised.
 */
export async function getPollVotes(
  guildId: string,
  id: string,
): Promise<ActionResult<{ votes: VoteBreakdownRow[]; anonymous: boolean }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'You must be signed in.' }

  const { data: poll } = await supabase.from('polls').select('anonymous').eq('id', id).eq('guild_id', guildId).maybeSingle()
  const anonymous = Boolean(poll?.anonymous)

  const { data, error } = await supabase
    .from('poll_votes')
    .select('user_id, user_name, option_id, weight, voted_at')
    .eq('guild_id', guildId)
    .eq('poll_id', id)
    .order('voted_at', { ascending: true })
  if (error) return { ok: false, error: error.message }

  const votes: VoteBreakdownRow[] = (data ?? []).map((v) => ({
    user_id: anonymous ? null : (v.user_id as string),
    user_name: anonymous ? null : ((v.user_name as string) ?? null),
    option_id: v.option_id as string,
    weight: Number(v.weight) || 1,
    voted_at: v.voted_at as string,
  }))
  return { ok: true, data: { votes, anonymous } }
}
