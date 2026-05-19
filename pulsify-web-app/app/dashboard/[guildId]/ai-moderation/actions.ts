'use server'

import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import {
  analyzeContent,
  chooseAction,
  normaliseSettings,
  type AIModerationSettings,
  type AnalysisVerdict,
  type AutoAction,
  CATEGORY_LABELS,
} from '@/lib/ai-moderation'
import {
  timeoutMemberDiscord,
  deleteChannelMessage,
} from '@/lib/discord'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

const DAILY_ANALYSIS_LIMIT = 200

async function loadSettings(guildId: string): Promise<AIModerationSettings> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('ai_moderation_settings')
    .select('enabled, sensitivity, settings')
    .eq('guild_id', guildId)
    .maybeSingle()
  const raw = (data?.settings as Partial<AIModerationSettings> | undefined) ?? {}
  return normaliseSettings({
    ...raw,
    enabled: data?.enabled ?? raw.enabled,
    sensitivity: (data?.sensitivity as AIModerationSettings['sensitivity']) ?? raw.sensitivity,
  })
}

export async function saveAIModerationSettings(
  guildId: string,
  settings: AIModerationSettings,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const normalised = normaliseSettings(settings)
  const supabase = await createClient()
  const { error } = await supabase
    .from('ai_moderation_settings')
    .upsert(
      {
        guild_id: guildId,
        enabled: normalised.enabled,
        sensitivity: normalised.sensitivity,
        settings: normalised,
        updated_by: auth.moderator.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'guild_id' },
    )

  if (error) return { ok: false, error: `Failed to save settings: ${error.message}` }

  await recordNotification({
    guildId,
    type: 'server_settings_changed',
    severity: 'info',
    title: normalised.enabled
      ? 'Pulse Guard settings updated'
      : 'Pulse Guard disabled',
    body: `Sensitivity: ${normalised.sensitivity}. ${Object.values(normalised.categories).filter((c) => c.enabled).length}/${Object.keys(normalised.categories).length} detectors active.`,
    link: `/dashboard/${guildId}/ai-moderation`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
  })

  return { ok: true }
}

type RunAnalysisInput = {
  content: string
  channelId?: string | null
  channelName?: string | null
  messageId?: string | null
  authorId?: string | null
  authorName?: string | null
  authorUsername?: string | null
  /** Skip recording the result — used for live "test in dashboard" previews. */
  dryRun?: boolean
}

export type RunAnalysisData = {
  verdict: AnalysisVerdict
  action: AutoAction
  eventId: string | null
  used: number
  remaining: number
  limit: number
}

export async function runAIAnalysis(
  guildId: string,
  input: RunAnalysisInput,
): Promise<ActionResult<RunAnalysisData>> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const trimmed = input.content?.trim() ?? ''
  if (!trimmed) return { ok: false, error: 'Provide some message text to analyse.' }
  if (trimmed.length > 4000) return { ok: false, error: 'Message is too long to analyse (max 4 000 characters).' }

  const supabase = await createClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('ai_moderation_events')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .gte('created_at', since)
  const used = count ?? 0
  if (used >= DAILY_ANALYSIS_LIMIT) {
    return { ok: false, error: 'Daily AI analysis limit reached for this server. Try again tomorrow.' }
  }

  const settings = await loadSettings(guildId)

  // Whitelisted users / channels never even get analysed.
  if (input.authorId && settings.whitelisted_user_ids.includes(input.authorId)) {
    return { ok: false, error: 'This user is whitelisted — analysis skipped.' }
  }
  if (input.channelId && settings.ignored_channel_ids.includes(input.channelId)) {
    return { ok: false, error: 'This channel is on the ignore list — analysis skipped.' }
  }

  const verdict = await analyzeContent(trimmed, settings)
  const action = chooseAction(verdict, settings)

  if (input.dryRun) {
    return {
      ok: true,
      data: {
        verdict,
        action,
        eventId: null,
        used,
        remaining: Math.max(0, DAILY_ANALYSIS_LIMIT - used),
        limit: DAILY_ANALYSIS_LIMIT,
      },
    }
  }

  const { data: inserted, error } = await supabase
    .from('ai_moderation_events')
    .insert({
      guild_id: guildId,
      message_id: input.messageId ?? null,
      channel_id: input.channelId ?? null,
      channel_name: input.channelName ?? null,
      author_id: input.authorId ?? null,
      author_name: input.authorName ?? null,
      author_username: input.authorUsername ?? null,
      content: trimmed.slice(0, 2000),
      categories: verdict.categories,
      top_category: verdict.topCategory,
      confidence: verdict.confidence,
      severity: verdict.severity,
      reasoning: verdict.reasoning,
      status: verdict.violates ? 'pending' : 'dismissed',
      action_taken: 'none',
      action_meta: {},
    })
    .select('id')
    .single()
  if (error || !inserted) {
    return { ok: false, error: `Failed to record analysis: ${error?.message ?? 'unknown error'}` }
  }

  // Real-time alert + notification feed entry on a violation.
  if (verdict.violates && settings.realtime_alerts) {
    await recordNotification({
      guildId,
      type: 'automation_triggered',
      severity: verdict.severity === 'high' ? 'error' : verdict.severity === 'medium' ? 'warning' : 'info',
      title: `AI flagged ${verdict.topCategory ? CATEGORY_LABELS[verdict.topCategory] : 'content'} in ${input.channelName ? `#${input.channelName}` : 'a channel'}`,
      body: verdict.reasoning.slice(0, 240),
      link: `/dashboard/${guildId}/ai-moderation`,
      actorId: input.authorId ?? null,
      actorName: input.authorName ?? null,
      actorUsername: input.authorUsername ?? null,
      targetId: input.messageId ?? null,
      targetName: input.channelName ?? null,
      metadata: {
        event_id: inserted.id,
        confidence: verdict.confidence,
        top_category: verdict.topCategory,
      },
    })
  }

  return {
    ok: true,
    data: {
      verdict,
      action,
      eventId: inserted.id,
      used: used + 1,
      remaining: Math.max(0, DAILY_ANALYSIS_LIMIT - used - 1),
      limit: DAILY_ANALYSIS_LIMIT,
    },
  }
}

export type ReviewDecision = 'resolved' | 'dismissed'

export async function reviewModerationEvent(
  guildId: string,
  eventId: string,
  decision: ReviewDecision,
  notes?: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase
    .from('ai_moderation_events')
    .update({
      status: decision,
      reviewer_id: auth.moderator.userId,
      reviewer_name: auth.moderator.username,
      reviewed_at: new Date().toISOString(),
      notes: notes?.slice(0, 500) ?? null,
    })
    .eq('id', eventId)
    .eq('guild_id', guildId)

  if (error) return { ok: false, error: `Failed to update event: ${error.message}` }
  return { ok: true }
}

export async function bulkReviewModerationEvents(
  guildId: string,
  eventIds: string[],
  decision: ReviewDecision,
): Promise<ActionResult<{ updated: number }>> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  if (eventIds.length === 0) return { ok: false, error: 'No events selected.' }

  const supabase = await createClient()
  const { error, count } = await supabase
    .from('ai_moderation_events')
    .update({
      status: decision,
      reviewer_id: auth.moderator.userId,
      reviewer_name: auth.moderator.username,
      reviewed_at: new Date().toISOString(),
    }, { count: 'exact' })
    .eq('guild_id', guildId)
    .in('id', eventIds)

  if (error) return { ok: false, error: `Failed to update events: ${error.message}` }
  return { ok: true, data: { updated: count ?? 0 } }
}

type ExecuteParams = {
  action: AutoAction
  channelId?: string | null
  messageId?: string | null
  authorId?: string | null
}

export async function executeModerationAction(
  guildId: string,
  eventId: string,
  params: ExecuteParams,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const settings = await loadSettings(guildId)
  const supabase = await createClient()

  if (params.action === 'delete') {
    if (!params.channelId || !params.messageId) {
      return { ok: false, error: 'Cannot delete: original message context is missing.' }
    }
    const res = await deleteChannelMessage(params.channelId, params.messageId, 'Pulse Guard auto-action')
    if (!res.ok) return { ok: false, error: res.error }
  } else if (params.action === 'timeout') {
    if (!params.authorId) return { ok: false, error: 'Cannot timeout: member is missing.' }
    const until = new Date(Date.now() + settings.timeout_minutes * 60_000).toISOString()
    const res = await timeoutMemberDiscord(guildId, params.authorId, until, 'Pulse Guard auto-action')
    if (!res.ok) return { ok: false, error: res.error }
  } else if (params.action === 'warn') {
    if (!params.authorId) return { ok: false, error: 'Cannot warn: member is missing.' }
    const { error } = await supabase.from('guild_warnings').insert({
      guild_id: guildId,
      user_id: params.authorId,
      username: null,
      moderator_id: auth.moderator.userId,
      moderator_username: auth.moderator.username,
      reason: 'Pulse Guard auto-action',
    })
    if (error) return { ok: false, error: `Failed to warn: ${error.message}` }
  } else if (params.action === 'flag') {
    // No-op besides marking the event status below.
  } else if (params.action === 'none') {
    return { ok: false, error: 'No action selected.' }
  }

  const { error: updateError } = await supabase
    .from('ai_moderation_events')
    .update({
      status: 'auto_actioned',
      action_taken: params.action,
      action_meta: {
        actor_id: auth.moderator.userId,
        actor_name: auth.moderator.username,
        executed_at: new Date().toISOString(),
      },
      reviewer_id: auth.moderator.userId,
      reviewer_name: auth.moderator.username,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', eventId)
    .eq('guild_id', guildId)
  if (updateError) return { ok: false, error: `Action ran, but event status update failed: ${updateError.message}` }

  return { ok: true }
}

