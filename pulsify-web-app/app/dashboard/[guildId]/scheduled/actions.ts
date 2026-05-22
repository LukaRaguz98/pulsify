'use server'

import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import {
  normaliseDraft,
  validateDraft,
  computeNextRun,
  ACTION_BY_TYPE,
  type AutomationDraft,
} from '@/lib/automations'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

/**
 * Create or update a workflow. New drafts (no id) insert; existing ones update
 * by id. The next fire time is recomputed here so the dashboard preview and the
 * bot's scheduler agree on when it runs — null while disabled.
 */
export async function saveAutomation(
  guildId: string,
  rawDraft: AutomationDraft,
): Promise<ActionResult<{ id: string }>> {
  const draft = normaliseDraft(rawDraft)
  const validationError = validateDraft(draft)
  if (validationError) return { ok: false, error: validationError }

  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const nextRun = draft.enabled
    ? computeNextRun(draft.schedule_type, draft.schedule_config, draft.timezone)
    : null

  const supabase = await createClient()
  const now = new Date().toISOString()

  const row = {
    guild_id: guildId,
    name: draft.name,
    enabled: draft.enabled,
    action_type: draft.action_type,
    action_config: draft.action_config,
    schedule_type: draft.schedule_type,
    schedule_config: draft.schedule_config,
    timezone: draft.timezone,
    conditions: draft.conditions,
    cooldown_minutes: draft.cooldown_minutes,
    max_retries: draft.max_retries,
    next_run_at: nextRun ? nextRun.toISOString() : null,
    updated_at: now,
    updated_by: auth.moderator.userId,
  }

  let savedId = rawDraft.id ?? ''
  if (rawDraft.id) {
    const { error } = await supabase
      .from('scheduled_automations')
      .update(row)
      .eq('id', rawDraft.id)
      .eq('guild_id', guildId)
    if (error) return { ok: false, error: `Failed to save workflow: ${error.message}` }
  } else {
    const { data, error } = await supabase
      .from('scheduled_automations')
      .insert({ ...row, created_at: now, created_by: auth.moderator.userId })
      .select('id')
      .single()
    if (error) return { ok: false, error: `Failed to create workflow: ${error.message}` }
    savedId = data.id as string
  }

  await recordNotification({
    guildId,
    type: 'automation_saved',
    severity: 'info',
    title: `Workflow "${draft.name}" ${rawDraft.id ? 'updated' : 'created'}`,
    body: `${ACTION_BY_TYPE[draft.action_type].label} · ${draft.enabled ? 'enabled' : 'disabled'}`,
    link: `/dashboard/${guildId}/scheduled`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    metadata: { automation_id: savedId, action_type: draft.action_type },
  })

  return { ok: true, data: { id: savedId } }
}

/** Flip the enabled flag, recomputing (or clearing) the next fire time. */
export async function toggleAutomation(
  guildId: string,
  id: string,
  enabled: boolean,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { data: existing, error: loadError } = await supabase
    .from('scheduled_automations')
    .select('schedule_type, schedule_config, timezone, name')
    .eq('id', id)
    .eq('guild_id', guildId)
    .maybeSingle()
  if (loadError) return { ok: false, error: loadError.message }
  if (!existing) return { ok: false, error: 'Workflow not found.' }

  const next = enabled
    ? computeNextRun(
        existing.schedule_type,
        existing.schedule_config,
        existing.timezone,
      )
    : null

  const { error } = await supabase
    .from('scheduled_automations')
    .update({
      enabled,
      next_run_at: next ? next.toISOString() : null,
      updated_at: new Date().toISOString(),
      updated_by: auth.moderator.userId,
    })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to update workflow: ${error.message}` }

  return { ok: true }
}

/** Permanently delete a workflow. Its run history (automation_runs) is kept. */
export async function deleteAutomation(
  guildId: string,
  id: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase
    .from('scheduled_automations')
    .delete()
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to delete workflow: ${error.message}` }

  await recordNotification({
    guildId,
    type: 'automation_saved',
    severity: 'info',
    title: 'Workflow deleted',
    link: `/dashboard/${guildId}/scheduled`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    metadata: { automation_id: id },
  })

  return { ok: true }
}

/**
 * Request an immediate one-off run ("Run now" / "Test"). We stamp
 * run_requested_at; the bot watches that column over realtime and fires the
 * action once, logging the outcome to automation_runs. The dashboard's live log
 * subscription surfaces the result within a second or two.
 */
export async function runAutomationNow(
  guildId: string,
  id: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase
    .from('scheduled_automations')
    .update({ run_requested_at: new Date().toISOString() })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to trigger workflow: ${error.message}` }

  return { ok: true }
}
