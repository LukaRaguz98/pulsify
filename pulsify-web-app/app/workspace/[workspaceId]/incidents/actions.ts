'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeWorkspaceMember } from '@/lib/workspace-auth'
import { recordWorkspaceActivity } from '@/lib/workspace-activity'
import {
  INCIDENT_STATUSES, SEVERITIES, parseMentions,
  type IncidentComment, type IncidentStatus,
} from '@/lib/workspace'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(workspaceId: string) {
  revalidatePath(`/workspace/${workspaceId}/incidents`)
  revalidatePath(`/workspace/${workspaceId}`)
}

export async function createIncident(
  workspaceId: string,
  input: { title: string; description?: string; severity?: string; assigneeId?: string | null; guildId?: string | null },
): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageIncidents')
  if (!auth.ok) return auth
  const title = input.title.trim()
  if (!title) return { ok: false, error: 'An incident needs a title.' }
  const severity = SEVERITIES.includes(input.severity as never) ? input.severity : 'medium'

  const supabase = await createClient()
  const { error } = await supabase.from('workspace_incidents').insert({
    workspace_id: workspaceId,
    title: title.slice(0, 200),
    description: input.description?.trim().slice(0, 4000) || null,
    severity,
    assignee_id: input.assigneeId || null,
    guild_id: input.guildId || null,
    created_by: auth.actor.userId,
  })
  if (error) return { ok: false, error: 'Could not open the incident.' }

  await recordWorkspaceActivity({
    workspaceId,
    actorId: auth.actor.userId,
    actorName: auth.actor.username,
    action: 'incident.created',
    guildId: input.guildId || null,
    summary: `${auth.actor.username ?? 'Someone'} opened incident “${title.slice(0, 60)}”`,
    metadata: { severity },
  })
  revalidate(workspaceId)
  return { ok: true }
}

export async function updateIncident(
  workspaceId: string,
  incidentId: string,
  input: { status?: string; severity?: string; assigneeId?: string | null; title?: string; description?: string },
): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageIncidents')
  if (!auth.ok) return auth

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  let statusChange: IncidentStatus | null = null
  if (input.status !== undefined && INCIDENT_STATUSES.includes(input.status as IncidentStatus)) {
    patch.status = input.status
    statusChange = input.status as IncidentStatus
    patch.resolved_at = input.status === 'resolved' || input.status === 'closed' ? new Date().toISOString() : null
  }
  if (input.severity !== undefined && SEVERITIES.includes(input.severity as never)) patch.severity = input.severity
  if (input.assigneeId !== undefined) patch.assignee_id = input.assigneeId || null
  if (input.title !== undefined) patch.title = input.title.trim().slice(0, 200)
  if (input.description !== undefined) patch.description = input.description.trim().slice(0, 4000) || null

  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from('workspace_incidents')
    .update(patch)
    .eq('id', incidentId)
    .eq('workspace_id', workspaceId)
    .select('title')
    .single()
  if (error) return { ok: false, error: 'Could not update the incident.' }

  if (statusChange) {
    await recordWorkspaceActivity({
      workspaceId,
      actorId: auth.actor.userId,
      actorName: auth.actor.username,
      action: 'incident.updated',
      summary: `${auth.actor.username ?? 'Someone'} marked “${(row?.title ?? '').slice(0, 50)}” ${statusChange}`,
    })
  }
  revalidate(workspaceId)
  return { ok: true }
}

export async function deleteIncident(workspaceId: string, incidentId: string): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageIncidents')
  if (!auth.ok) return auth
  const supabase = await createClient()
  const { error } = await supabase.from('workspace_incidents').delete().eq('id', incidentId).eq('workspace_id', workspaceId)
  if (error) return { ok: false, error: 'Could not delete the incident.' }
  revalidate(workspaceId)
  return { ok: true }
}

export async function addIncidentComment(workspaceId: string, incidentId: string, body: string): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageIncidents')
  if (!auth.ok) return auth
  const text = body.trim()
  if (!text) return { ok: false, error: 'Comment can’t be empty.' }

  const supabase = await createClient()
  // Confirm the incident belongs to this workspace before commenting.
  const { data: incident } = await supabase
    .from('workspace_incidents')
    .select('id, title')
    .eq('id', incidentId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!incident) return { ok: false, error: 'Incident not found.' }

  const { data: memberRows } = await supabase.from('workspace_members').select('user_id, display_name').eq('workspace_id', workspaceId)
  const mentions = parseMentions(text, memberRows ?? [])

  const { error } = await supabase.from('workspace_incident_comments').insert({
    incident_id: incidentId,
    author_id: auth.actor.userId,
    author_name: auth.actor.username,
    body: text.slice(0, 2000),
    mentions,
  })
  if (error) return { ok: false, error: 'Could not add the comment.' }

  await recordWorkspaceActivity({
    workspaceId,
    actorId: auth.actor.userId,
    actorName: auth.actor.username,
    action: 'comment.added',
    targetType: 'incident',
    targetId: incidentId,
    summary: `${auth.actor.username ?? 'Someone'} commented on “${incident.title.slice(0, 50)}”`,
    metadata: { mentions },
  })
  revalidate(workspaceId)
  return { ok: true }
}

export async function getIncidentComments(workspaceId: string, incidentId: string): Promise<ActionResult<{ comments: IncidentComment[] }>> {
  const auth = await authorizeWorkspaceMember(workspaceId)
  if (!auth.ok) return auth
  const supabase = await createClient()
  const { data } = await supabase
    .from('workspace_incident_comments')
    .select('*')
    .eq('incident_id', incidentId)
    .order('created_at', { ascending: true })
  return { ok: true, data: { comments: (data ?? []) as IncidentComment[] } }
}
