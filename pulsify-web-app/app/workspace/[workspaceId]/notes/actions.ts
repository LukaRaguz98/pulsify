'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeWorkspaceMember } from '@/lib/workspace-auth'
import { recordWorkspaceActivity } from '@/lib/workspace-activity'
import { parseMentions } from '@/lib/workspace'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(workspaceId: string) {
  revalidatePath(`/workspace/${workspaceId}/notes`)
}

async function resolveMentions(workspaceId: string, body: string): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('workspace_members')
    .select('user_id, display_name')
    .eq('workspace_id', workspaceId)
  return parseMentions(body, data ?? [])
}

export async function createNote(
  workspaceId: string,
  input: { body: string; guildId?: string | null; subjectUserId?: string | null; pinned?: boolean },
): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageNotes')
  if (!auth.ok) return auth

  const body = input.body.trim()
  if (!body) return { ok: false, error: 'A note can’t be empty.' }
  if (body.length > 4000) return { ok: false, error: 'Notes are limited to 4000 characters.' }

  const mentions = await resolveMentions(workspaceId, body)
  const supabase = await createClient()
  const { error } = await supabase.from('workspace_notes').insert({
    workspace_id: workspaceId,
    guild_id: input.guildId ?? null,
    subject_user_id: input.subjectUserId?.trim() || null,
    author_id: auth.actor.userId,
    author_name: auth.actor.username,
    body,
    mentions,
    pinned: input.pinned ?? false,
  })
  if (error) return { ok: false, error: 'Could not save the note.' }

  await recordWorkspaceActivity({
    workspaceId,
    actorId: auth.actor.userId,
    actorName: auth.actor.username,
    action: 'note.created',
    guildId: input.guildId ?? null,
    summary: `${auth.actor.username ?? 'Someone'} added a note${mentions.length ? ` mentioning ${mentions.length} teammate${mentions.length === 1 ? '' : 's'}` : ''}`,
    metadata: { mentions },
  })

  revalidate(workspaceId)
  return { ok: true }
}

export async function updateNote(
  workspaceId: string,
  noteId: string,
  input: { body: string },
): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageNotes')
  if (!auth.ok) return auth
  const body = input.body.trim()
  if (!body) return { ok: false, error: 'A note can’t be empty.' }

  const mentions = await resolveMentions(workspaceId, body)
  const supabase = await createClient()
  const { error } = await supabase
    .from('workspace_notes')
    .update({ body, mentions, updated_at: new Date().toISOString() })
    .eq('id', noteId)
    .eq('workspace_id', workspaceId)
  if (error) return { ok: false, error: 'Could not update the note.' }
  revalidate(workspaceId)
  return { ok: true }
}

export async function togglePinNote(workspaceId: string, noteId: string, pinned: boolean): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageNotes')
  if (!auth.ok) return auth
  const supabase = await createClient()
  const { error } = await supabase
    .from('workspace_notes')
    .update({ pinned })
    .eq('id', noteId)
    .eq('workspace_id', workspaceId)
  if (error) return { ok: false, error: 'Could not update the note.' }
  revalidate(workspaceId)
  return { ok: true }
}

export async function deleteNote(workspaceId: string, noteId: string): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageNotes')
  if (!auth.ok) return auth
  const supabase = await createClient()
  const { error } = await supabase
    .from('workspace_notes')
    .delete()
    .eq('id', noteId)
    .eq('workspace_id', workspaceId)
  if (error) return { ok: false, error: 'Could not delete the note.' }
  revalidate(workspaceId)
  return { ok: true }
}
