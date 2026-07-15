'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import { readGuildEmbedInt } from '@/lib/embed-color'
import { fetchGuild, postChannelComponents, type V2TopLevelComponent } from '@/lib/discord'
import {
  validateMilestoneDraft,
  draftToRow,
  renderMilestoneMessage,
  formatMetricValue,
  DEFAULT_MILESTONE_MESSAGE,
  type MilestoneDraft,
} from '@/lib/milestones'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/milestones`)
}

/**
 * Invite milestones (metric `invites`) are granted against the invite-tracking
 * system, so they can only be saved when that system is enabled. Returns an
 * error result to short-circuit with, or null when the save may proceed.
 */
async function ensureInviteTracking(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
  metric: string,
): Promise<{ ok: false; error: string } | null> {
  if (metric !== 'invites') return null
  const { data } = await supabase.from('invite_settings').select('enabled').eq('guild_id', guildId).maybeSingle()
  if (data?.enabled === true) return null
  return { ok: false, error: 'Turn on invite tracking (Engagement › Invites) before saving an invite milestone.' }
}

// ── Discord embed (MUST match pulse-bot/src/milestones.js milestoneContainer) ──

const td = (content: string) => ({ type: 10, content })

/**
 * Build the milestone congratulations container exactly as the bot does
 * (milestones.js milestoneContainer): the rendered message, an optional
 * "Unlocked roles" line, and the `Pulse — Milestone` footer. Used by the "Send
 * test" preview so what the admin sees is what members will get.
 *
 * No header badge — an unlock is a sentence, and a thumbnail beside it takes
 * more room than the message (the rule the bot follows; see the embed
 * conventions on buildPulseContainer in pulse-bot/src/commands.js). The colour is
 * the guild's accent, like every other Pulse embed.
 */
function milestoneContainer(opts: {
  name: string
  message: string
  rewardRoleIds: string[]
  rendered: string
  accent: number
}): V2TopLevelComponent {
  const body: Record<string, unknown>[] = [td('**Pulse**'), td(`# ${opts.name}`)]
  body.push(td(opts.rendered))
  if (opts.rewardRoleIds.length > 0) {
    body.push(td(`-# Unlocked: ${opts.rewardRoleIds.map((id) => `<@&${id}>`).join(', ')}`))
  }
  body.push(td('-# Pulse — Milestone'))
  return { type: 17, accent_color: opts.accent, components: body } as unknown as V2TopLevelComponent
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createMilestone(
  guildId: string,
  draft: MilestoneDraft,
): Promise<ActionResult<{ id: string }>> {
  const validationError = validateMilestoneDraft(draft)
  if (validationError) return { ok: false, error: validationError }

  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()

  // Invite milestones only make sense with invite tracking on.
  const inviteGuard = await ensureInviteTracking(supabase, guildId, draft.metric)
  if (inviteGuard) return inviteGuard

  // Guard against unbounded milestone counts per guild.
  const { count } = await supabase
    .from('milestones')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId)
  if ((count ?? 0) >= 100) {
    return { ok: false, error: 'You\'ve reached the milestone limit (100) for this server.' }
  }

  const row = draftToRow(draft)
  const { data: inserted, error } = await supabase
    .from('milestones')
    .insert({ ...row, guild_id: guildId, created_by: auth.moderator.userId })
    .select('id')
    .single()
  if (error || !inserted) {
    return { ok: false, error: `Failed to create milestone: ${error?.message ?? 'unknown error'}` }
  }

  await recordNotification({
    guildId,
    type: 'milestone_reached',
    severity: 'info',
    title: `Milestone created: ${row.name}`,
    body: `Rewards ${row.rewards.length} role${row.rewards.length === 1 ? '' : 's'} on completion.`,
    link: `/dashboard/${guildId}/milestones`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    metadata: { milestone_id: inserted.id as string, created: true },
  })

  revalidate(guildId)
  return { ok: true, data: { id: inserted.id as string } }
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateMilestone(
  guildId: string,
  id: string,
  draft: MilestoneDraft,
): Promise<ActionResult> {
  const validationError = validateMilestoneDraft(draft)
  if (validationError) return { ok: false, error: validationError }

  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()

  const inviteGuard = await ensureInviteTracking(supabase, guildId, draft.metric)
  if (inviteGuard) return inviteGuard

  const row = draftToRow(draft)
  const { error } = await supabase
    .from('milestones')
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to save: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}

// ── Enable / disable ────────────────────────────────────────────────────────

export async function toggleMilestone(
  guildId: string,
  id: string,
  enabled: boolean,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase
    .from('milestones')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: error.message }

  revalidate(guildId)
  return { ok: true }
}

// ── Delete ────────────────────────────────────────────────────────────────────

/** Delete a milestone and (via ON DELETE CASCADE) its completion history. */
export async function deleteMilestone(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase.from('milestones').delete().eq('id', id).eq('guild_id', guildId)
  if (error) return { ok: false, error: error.message }

  revalidate(guildId)
  return { ok: true }
}

// ── Test (post a sample of the milestone embed to a channel) ──────────────────

export async function testMilestone(
  guildId: string,
  draft: MilestoneDraft,
  channelId: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  if (!channelId) return { ok: false, error: 'Pick a channel to send the test to.' }

  const row = draftToRow(draft)
  const guild = await fetchGuild(guildId).catch(() => null)
  const rendered = renderMilestoneMessage(row.message || DEFAULT_MILESTONE_MESSAGE, {
    user: auth.moderator.username ?? 'member',
    mention: `<@${auth.moderator.userId}>`,
    milestone: row.name,
    server: guild?.name ?? 'this server',
    value: formatMetricValue(row.metric, row.threshold),
  })

  const supabase = await createClient()
  const accent = await readGuildEmbedInt(supabase, guildId)

  const res = await postChannelComponents(channelId, [
    milestoneContainer({
      name: row.name,
      message: row.message,
      rewardRoleIds: row.rewards.map((r) => r.role_id),
      rendered,
      accent,
    }),
  ])
  if (!res.ok) return { ok: false, error: `Couldn't post the test: ${res.error}` }
  return { ok: true }
}
