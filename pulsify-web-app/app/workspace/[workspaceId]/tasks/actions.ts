'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeWorkspaceMember } from '@/lib/workspace-auth'
import { recordWorkspaceActivity } from '@/lib/workspace-activity'
import { TASK_STATUSES, PRIORITIES, type TaskStatus } from '@/lib/workspace'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(workspaceId: string) {
  revalidatePath(`/workspace/${workspaceId}/tasks`)
  revalidatePath(`/workspace/${workspaceId}`)
}

export async function createTask(
  workspaceId: string,
  input: { title: string; description?: string; priority?: string; assigneeId?: string | null; guildId?: string | null; dueAt?: string | null },
): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageTasks')
  if (!auth.ok) return auth
  const title = input.title.trim()
  if (!title) return { ok: false, error: 'A task needs a title.' }
  const priority = PRIORITIES.includes(input.priority as never) ? input.priority : 'normal'

  const supabase = await createClient()
  const { error } = await supabase.from('workspace_tasks').insert({
    workspace_id: workspaceId,
    title: title.slice(0, 200),
    description: input.description?.trim().slice(0, 2000) || null,
    priority,
    assignee_id: input.assigneeId || null,
    guild_id: input.guildId || null,
    due_at: input.dueAt || null,
    created_by: auth.actor.userId,
  })
  if (error) return { ok: false, error: 'Could not create the task.' }

  await recordWorkspaceActivity({
    workspaceId,
    actorId: auth.actor.userId,
    actorName: auth.actor.username,
    action: 'task.created',
    summary: `${auth.actor.username ?? 'Someone'} created task “${title.slice(0, 60)}”`,
  })
  revalidate(workspaceId)
  return { ok: true }
}

export async function updateTaskStatus(workspaceId: string, taskId: string, status: string): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageTasks')
  if (!auth.ok) return auth
  if (!TASK_STATUSES.includes(status as TaskStatus)) return { ok: false, error: 'Invalid status.' }

  const supabase = await createClient()
  const { data: task, error } = await supabase
    .from('workspace_tasks')
    .update({ status, completed_at: status === 'done' ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('workspace_id', workspaceId)
    .select('title')
    .single()
  if (error) return { ok: false, error: 'Could not update the task.' }

  if (status === 'done') {
    await recordWorkspaceActivity({
      workspaceId,
      actorId: auth.actor.userId,
      actorName: auth.actor.username,
      action: 'task.completed',
      summary: `${auth.actor.username ?? 'Someone'} completed task “${(task?.title ?? '').slice(0, 60)}”`,
    })
  }
  revalidate(workspaceId)
  return { ok: true }
}

export async function updateTask(
  workspaceId: string,
  taskId: string,
  input: { title?: string; description?: string; priority?: string; assigneeId?: string | null; dueAt?: string | null },
): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageTasks')
  if (!auth.ok) return auth
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.title !== undefined) patch.title = input.title.trim().slice(0, 200)
  if (input.description !== undefined) patch.description = input.description.trim().slice(0, 2000) || null
  if (input.priority !== undefined && PRIORITIES.includes(input.priority as never)) patch.priority = input.priority
  if (input.assigneeId !== undefined) patch.assignee_id = input.assigneeId || null
  if (input.dueAt !== undefined) patch.due_at = input.dueAt || null

  const supabase = await createClient()
  const { error } = await supabase.from('workspace_tasks').update(patch).eq('id', taskId).eq('workspace_id', workspaceId)
  if (error) return { ok: false, error: 'Could not update the task.' }
  revalidate(workspaceId)
  return { ok: true }
}

export async function deleteTask(workspaceId: string, taskId: string): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageTasks')
  if (!auth.ok) return auth
  const supabase = await createClient()
  const { error } = await supabase.from('workspace_tasks').delete().eq('id', taskId).eq('workspace_id', workspaceId)
  if (error) return { ok: false, error: 'Could not delete the task.' }
  revalidate(workspaceId)
  return { ok: true }
}
