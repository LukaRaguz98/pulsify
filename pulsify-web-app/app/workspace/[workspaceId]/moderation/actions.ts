'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeWorkspaceMember } from '@/lib/workspace-auth'
import { recordWorkspaceActivity } from '@/lib/workspace-activity'
import { WATCHLIST_KINDS, SEVERITIES, WATCHLIST_KIND_LABELS, type WatchlistKind } from '@/lib/workspace'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(workspaceId: string) {
  revalidatePath(`/workspace/${workspaceId}/moderation`)
}

export async function addWatchlistEntry(
  workspaceId: string,
  input: { userId: string; userName?: string; kind: string; severity?: string; reason?: string },
): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageWatchlist')
  if (!auth.ok) return auth

  const userId = input.userId.trim()
  if (!/^\d{5,25}$/.test(userId)) return { ok: false, error: 'Enter a valid Discord user ID.' }
  const kind: WatchlistKind = WATCHLIST_KINDS.includes(input.kind as WatchlistKind) ? (input.kind as WatchlistKind) : 'watch'
  const severity = SEVERITIES.includes(input.severity as never) ? input.severity : 'medium'

  const supabase = await createClient()
  const { error } = await supabase.from('workspace_watchlist').upsert(
    {
      workspace_id: workspaceId,
      user_id: userId,
      user_name: input.userName?.trim().slice(0, 80) || null,
      kind,
      severity,
      reason: input.reason?.trim().slice(0, 500) || null,
      added_by: auth.actor.userId,
      added_by_name: auth.actor.username,
    },
    { onConflict: 'workspace_id,user_id,kind' },
  )
  if (error) return { ok: false, error: 'Could not add the entry.' }

  await recordWorkspaceActivity({
    workspaceId,
    actorId: auth.actor.userId,
    actorName: auth.actor.username,
    action: 'watchlist.added',
    category: 'watchlist',
    targetType: 'user',
    targetId: userId,
    summary: `${auth.actor.username ?? 'Someone'} added ${input.userName ?? userId} to the ${WATCHLIST_KIND_LABELS[kind].toLowerCase()} list`,
  })
  revalidate(workspaceId)
  return { ok: true }
}

export async function removeWatchlistEntry(workspaceId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageWatchlist')
  if (!auth.ok) return auth
  const supabase = await createClient()
  const { error } = await supabase.from('workspace_watchlist').delete().eq('id', id).eq('workspace_id', workspaceId)
  if (error) return { ok: false, error: 'Could not remove the entry.' }
  revalidate(workspaceId)
  return { ok: true }
}
