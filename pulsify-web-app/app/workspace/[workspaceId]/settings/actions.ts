'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeWorkspaceMember, getWorkspaceRole } from '@/lib/workspace-auth'
import { recordWorkspaceActivity } from '@/lib/workspace-activity'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(workspaceId: string) {
  revalidatePath(`/workspace/${workspaceId}/settings`)
  revalidatePath(`/workspace/${workspaceId}`)
  revalidatePath('/workspace')
}

export async function updateWorkspace(
  workspaceId: string,
  input: { name?: string; accent?: string; logoUrl?: string | null },
): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageWorkspace')
  if (!auth.ok) return auth

  const supabase = await createClient()
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 60)
    if (!name) return { ok: false, error: 'Workspace name is required.' }
    patch.name = name
  }
  if (input.logoUrl !== undefined) patch.logo_url = input.logoUrl

  // Merge accent into the existing settings jsonb rather than overwrite it.
  if (input.accent !== undefined) {
    const { data: ws } = await supabase.from('workspaces').select('settings').eq('id', workspaceId).maybeSingle()
    patch.settings = { ...((ws?.settings as Record<string, unknown>) ?? {}), accent: input.accent }
  }

  const { error } = await supabase.from('workspaces').update(patch).eq('id', workspaceId)
  if (error) return { ok: false, error: 'Could not save changes.' }

  await recordWorkspaceActivity({
    workspaceId,
    actorId: auth.actor.userId,
    actorName: auth.actor.username,
    action: 'workspace.updated',
    summary: `${auth.actor.username ?? 'Someone'} updated workspace settings`,
  })
  revalidate(workspaceId)
  return { ok: true }
}

export async function leaveWorkspace(workspaceId: string): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId)
  if (!auth.ok) return auth
  if (auth.role === 'owner') {
    return { ok: false, error: 'Transfer ownership before leaving the workspace.' }
  }
  const supabase = await createClient()
  const { error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', auth.actor.userId)
  if (error) return { ok: false, error: 'Could not leave the workspace.' }

  await recordWorkspaceActivity({
    workspaceId,
    actorId: auth.actor.userId,
    actorName: auth.actor.username,
    action: 'member.left',
    summary: `${auth.actor.username ?? 'Someone'} left the workspace`,
  })
  return { ok: true }
}

export async function transferOwnership(workspaceId: string, newOwnerId: string): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId)
  if (!auth.ok) return auth
  if (auth.role !== 'owner') return { ok: false, error: 'Only the owner can transfer ownership.' }
  if (newOwnerId === auth.actor.userId) return { ok: false, error: "You're already the owner." }

  const targetRole = await getWorkspaceRole(workspaceId, newOwnerId)
  if (!targetRole) return { ok: false, error: 'That person is not a member of this workspace.' }

  const supabase = await createClient()
  await supabase.from('workspaces').update({ owner_id: newOwnerId, updated_at: new Date().toISOString() }).eq('id', workspaceId)
  await supabase.from('workspace_members').update({ role: 'owner' }).eq('workspace_id', workspaceId).eq('user_id', newOwnerId)
  await supabase.from('workspace_members').update({ role: 'admin' }).eq('workspace_id', workspaceId).eq('user_id', auth.actor.userId)

  await recordWorkspaceActivity({
    workspaceId,
    actorId: auth.actor.userId,
    actorName: auth.actor.username,
    action: 'workspace.ownership_transferred',
    targetType: 'member',
    targetId: newOwnerId,
    summary: `${auth.actor.username ?? 'Someone'} transferred ownership`,
  })
  revalidate(workspaceId)
  return { ok: true }
}

export async function deleteWorkspace(workspaceId: string): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId)
  if (!auth.ok) return auth
  if (auth.role !== 'owner') return { ok: false, error: 'Only the owner can delete the workspace.' }

  const supabase = await createClient()
  // FK cascades remove members, servers, notes, tasks, incidents, etc.
  const { error } = await supabase.from('workspaces').delete().eq('id', workspaceId)
  if (error) return { ok: false, error: 'Could not delete the workspace.' }
  revalidatePath('/workspace')
  return { ok: true }
}
