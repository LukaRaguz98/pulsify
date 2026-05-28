'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeWorkspaceMember } from '@/lib/workspace-auth'
import { recordWorkspaceActivity } from '@/lib/workspace-activity'
import {
  ROLE_RANK, ROLE_LABELS, assignableRoles, isWorkspaceRole,
  type WorkspaceActivityRow, type WorkspaceRole,
} from '@/lib/workspace'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(workspaceId: string) {
  revalidatePath(`/workspace/${workspaceId}/team`)
}

function genCode(): string {
  return randomUUID().replace(/-/g, '').slice(0, 14)
}

export async function createInvite(
  workspaceId: string,
  input: { role: string; label?: string; expiresInDays?: number; maxUses?: number },
): Promise<ActionResult<{ code: string }>> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageMembers')
  if (!auth.ok) return auth

  if (!isWorkspaceRole(input.role) || !assignableRoles(auth.role).includes(input.role)) {
    return { ok: false, error: "You can't create invites for that role." }
  }

  const expires_at = input.expiresInDays && input.expiresInDays > 0
    ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
    : null
  const max_uses = input.maxUses && input.maxUses > 0 ? Math.min(input.maxUses, 1000) : null

  const code = genCode()
  const supabase = await createClient()
  const { error } = await supabase.from('workspace_invites').insert({
    workspace_id: workspaceId,
    code,
    role: input.role,
    label: input.label?.trim().slice(0, 80) || null,
    created_by: auth.actor.userId,
    expires_at,
    max_uses,
  })
  if (error) return { ok: false, error: 'Could not create the invite.' }

  await recordWorkspaceActivity({
    workspaceId,
    actorId: auth.actor.userId,
    actorName: auth.actor.username,
    action: 'invite.created',
    summary: `${auth.actor.username ?? 'Someone'} created a ${ROLE_LABELS[input.role]} invite`,
  })

  revalidate(workspaceId)
  return { ok: true, data: { code } }
}

export async function revokeInvite(workspaceId: string, inviteId: string): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageMembers')
  if (!auth.ok) return auth
  const supabase = await createClient()
  const { error } = await supabase
    .from('workspace_invites')
    .update({ revoked: true })
    .eq('id', inviteId)
    .eq('workspace_id', workspaceId)
  if (error) return { ok: false, error: 'Could not revoke the invite.' }
  revalidate(workspaceId)
  return { ok: true }
}

/** Shared guard: load the target member + verify the actor outranks them. */
async function loadActable(
  workspaceId: string,
  targetUserId: string,
  actorRole: WorkspaceRole,
  actorUserId: string,
): Promise<{ ok: true; target: { user_id: string; role: WorkspaceRole; display_name: string | null } } | { ok: false; error: string }> {
  if (targetUserId === actorUserId) return { ok: false, error: 'You can’t change your own membership here.' }
  const supabase = await createClient()
  const { data: target } = await supabase
    .from('workspace_members')
    .select('user_id, role, display_name')
    .eq('workspace_id', workspaceId)
    .eq('user_id', targetUserId)
    .maybeSingle()
  if (!target) return { ok: false, error: 'That member is no longer in the workspace.' }
  if (target.role === 'owner') return { ok: false, error: 'The owner’s membership can only change via ownership transfer.' }
  // Only an owner may act on someone of equal-or-higher rank than the actor.
  if (actorRole !== 'owner' && ROLE_RANK[target.role as WorkspaceRole] >= ROLE_RANK[actorRole]) {
    return { ok: false, error: 'You can only manage members below your own role.' }
  }
  return { ok: true, target: target as { user_id: string; role: WorkspaceRole; display_name: string | null } }
}

export async function changeMemberRole(workspaceId: string, userId: string, role: string): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageMembers')
  if (!auth.ok) return auth
  if (!isWorkspaceRole(role) || !assignableRoles(auth.role).includes(role)) {
    return { ok: false, error: "You can't assign that role." }
  }
  const guard = await loadActable(workspaceId, userId, auth.role, auth.actor.userId)
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { error } = await supabase
    .from('workspace_members')
    .update({ role })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
  if (error) return { ok: false, error: 'Could not update the role.' }

  await recordWorkspaceActivity({
    workspaceId,
    actorId: auth.actor.userId,
    actorName: auth.actor.username,
    action: 'member.role_changed',
    targetType: 'member',
    targetId: userId,
    summary: `${auth.actor.username ?? 'Someone'} set ${guard.target.display_name ?? 'a member'} to ${ROLE_LABELS[role]}`,
  })
  revalidate(workspaceId)
  return { ok: true }
}

export async function removeMember(workspaceId: string, userId: string): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageMembers')
  if (!auth.ok) return auth
  const guard = await loadActable(workspaceId, userId, auth.role, auth.actor.userId)
  if (!guard.ok) return guard

  const supabase = await createClient()
  const { error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
  if (error) return { ok: false, error: 'Could not remove the member.' }

  await recordWorkspaceActivity({
    workspaceId,
    actorId: auth.actor.userId,
    actorName: auth.actor.username,
    action: 'member.removed',
    targetType: 'member',
    targetId: userId,
    summary: `${auth.actor.username ?? 'Someone'} removed ${guard.target.display_name ?? 'a member'}`,
  })
  revalidate(workspaceId)
  return { ok: true }
}

/** Read a member's recent activity for the per-staff activity drawer. */
export async function getMemberActivity(workspaceId: string, userId: string): Promise<ActionResult<{ rows: WorkspaceActivityRow[] }>> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'viewActivity')
  if (!auth.ok) return auth
  const supabase = await createClient()
  const { data } = await supabase
    .from('workspace_activity')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('actor_id', userId)
    .order('created_at', { ascending: false })
    .limit(30)
  return { ok: true, data: { rows: (data ?? []) as WorkspaceActivityRow[] } }
}
