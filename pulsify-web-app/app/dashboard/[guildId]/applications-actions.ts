'use server'

// Server actions for the Applications review workflow (PULSIFY-43).
//
// Applications are channel-less submissions stored in `ticket_applications` and
// reviewed here in Pulsify. Every status change appends a `status_changed`
// event to `application_events` — the BOT watches those (realtime) and DMs the
// applicant their decision, so these actions never touch Discord directly.
//
// Mirrors the auth + result conventions of tickets/actions.ts: mutations go
// through authorizeGuildModerator; reads use getUser() only (cheap, rate-limit
// friendly). Reuses the shared ActionResult shape.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import { fetchGuildMember } from '@/lib/discord'
import {
  APPLICATION_STATUS_META,
  APPLICATION_LIMITS,
  applicationTypeDisplay,
  normaliseApplicationStatus,
  type ApplicationStatus,
  type ApplicationEvent,
  type ApplicationEventType,
} from '@/lib/applications'
import type { ActionResult } from '@/app/dashboard/[guildId]/(management)/tickets/actions'

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/tickets`)
}

type ApplicationRow = {
  id: string
  guild_id: string
  number: number
  type_id: string | null
  type_label: string | null
  custom_type: string | null
  applicant_id: string
  applicant_name: string | null
  status: string
}

async function loadApplication(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
  id: string,
): Promise<ApplicationRow | null> {
  const { data } = await supabase
    .from('ticket_applications')
    .select('id, guild_id, number, type_id, type_label, custom_type, applicant_id, applicant_name, status')
    .eq('id', id)
    .eq('guild_id', guildId)
    .maybeSingle()
  return (data as ApplicationRow | null) ?? null
}

/** Append a review-history / audit entry. Best-effort — never blocks the action. */
async function recordApplicationEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    applicationId: string
    guildId: string
    type: ApplicationEventType
    actorId?: string | null
    actorName?: string | null
    detail?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  try {
    await supabase.from('application_events').insert({
      application_id: input.applicationId,
      guild_id: input.guildId,
      type: input.type,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
      detail: input.detail ? String(input.detail).slice(0, 1000) : null,
      metadata: input.metadata ?? {},
    })
  } catch (e) {
    console.error('[applications] event insert threw', e)
  }
}

// ── Status (approve / reject / request info) ─────────────────────────────────

export async function setApplicationStatus(
  guildId: string,
  id: string,
  status: ApplicationStatus,
  note?: string,
): Promise<ActionResult> {
  const cleanStatus = normaliseApplicationStatus(status)
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const app = await loadApplication(supabase, guildId, id)
  if (!app) return { ok: false, error: 'Application not found.' }
  if (app.status === cleanStatus) return { ok: false, error: `This application is already ${APPLICATION_STATUS_META[cleanStatus].label.toLowerCase()}.` }

  const decisionNote = (note ?? '').trim().slice(0, APPLICATION_LIMITS.maxDecisionNoteLength) || null
  const decided = cleanStatus === 'approved' || cleanStatus === 'rejected'

  const { error } = await supabase
    .from('ticket_applications')
    .update({
      status: cleanStatus,
      decision_note: decisionNote,
      decided_at: decided ? new Date().toISOString() : null,
      decided_by: decided ? auth.moderator.userId : null,
      decided_by_name: decided ? auth.moderator.username : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to update application: ${error.message}` }

  // The bot watches `status_changed` events to DM the applicant — metadata
  // carries the new status + public note so it can compose the message.
  await recordApplicationEvent(supabase, {
    applicationId: id,
    guildId,
    type: 'status_changed',
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    detail: `→ ${APPLICATION_STATUS_META[cleanStatus].label}${decisionNote ? ` — ${decisionNote}` : ''}`,
    metadata: { status: cleanStatus, note: decisionNote },
  })

  const display = applicationTypeDisplay(app)
  await recordNotification({
    guildId,
    type: 'application_status_changed',
    title: `${display} application #${app.number} ${APPLICATION_STATUS_META[cleanStatus].label.toLowerCase()}`,
    body: decisionNote ?? undefined,
    link: `/dashboard/${guildId}/tickets?tab=applications&id=${id}`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    metadata: { application_id: id, status: cleanStatus },
  })

  revalidate(guildId)
  return { ok: true }
}

// ── Reviewer assignment ──────────────────────────────────────────────────────

export async function assignApplicationReviewer(
  guildId: string,
  id: string,
  userId: string,
): Promise<ActionResult> {
  const cleanId = userId.trim()
  if (!/^\d{15,21}$/.test(cleanId)) return { ok: false, error: 'Enter a valid Discord user ID.' }
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const app = await loadApplication(supabase, guildId, id)
  if (!app) return { ok: false, error: 'Application not found.' }

  const member = await fetchGuildMember(guildId, cleanId)
  if (!member) return { ok: false, error: 'That member is not in this server.' }
  const name = member.nick ?? member.user.global_name ?? member.user.username

  await supabase
    .from('ticket_applications')
    .update({ reviewer_id: cleanId, reviewer_name: name, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('guild_id', guildId)
  await recordApplicationEvent(supabase, {
    applicationId: id,
    guildId,
    type: 'assigned',
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    detail: `Assigned to ${name}`,
  })
  revalidate(guildId)
  return { ok: true }
}

export async function clearApplicationReviewer(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const app = await loadApplication(supabase, guildId, id)
  if (!app) return { ok: false, error: 'Application not found.' }

  await supabase
    .from('ticket_applications')
    .update({ reviewer_id: null, reviewer_name: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('guild_id', guildId)
  await recordApplicationEvent(supabase, {
    applicationId: id,
    guildId,
    type: 'reviewer_cleared',
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
  })
  revalidate(guildId)
  return { ok: true }
}

// ── Internal note (never DM'd to the applicant) ──────────────────────────────

export async function addApplicationNote(
  guildId: string,
  id: string,
  note: string,
): Promise<ActionResult> {
  const body = note.trim()
  if (!body) return { ok: false, error: 'Note cannot be empty.' }
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const app = await loadApplication(supabase, guildId, id)
  if (!app) return { ok: false, error: 'Application not found.' }

  await recordApplicationEvent(supabase, {
    applicationId: id,
    guildId,
    type: 'note',
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    detail: body.slice(0, APPLICATION_LIMITS.maxNoteLength),
  })
  revalidate(guildId)
  return { ok: true }
}

// ── Read: review history (light auth — read-only) ────────────────────────────

export async function getApplicationEvents(
  guildId: string,
  id: string,
): Promise<ActionResult<{ events: ApplicationEvent[] }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'You must be signed in.' }

  const { data, error } = await supabase
    .from('application_events')
    .select('id, application_id, type, actor_id, actor_name, detail, created_at')
    .eq('guild_id', guildId)
    .eq('application_id', id)
    .order('created_at', { ascending: true })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: { events: (data ?? []) as ApplicationEvent[] } }
}
