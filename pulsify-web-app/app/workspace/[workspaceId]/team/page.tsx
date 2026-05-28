import { createClient } from '@/lib/supabase-server'
import { getWorkspaceMembers } from '@/lib/workspace-data'
import { TeamContent } from '@/components/workspace/TeamContent'
import type { WorkspaceInvite } from '@/lib/workspace'

export default async function WorkspaceTeamPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const supabase = await createClient()

  const [members, invitesRes, activityRes] = await Promise.all([
    getWorkspaceMembers(workspaceId),
    supabase.from('workspace_invites').select('*').eq('workspace_id', workspaceId).eq('revoked', false).order('created_at', { ascending: false }),
    supabase.from('workspace_activity').select('actor_id').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(500),
  ])

  // Approximate "recent actions" per member from the last 500 activity rows.
  const counts: Record<string, number> = {}
  for (const r of activityRes.data ?? []) {
    if (r.actor_id) counts[r.actor_id] = (counts[r.actor_id] ?? 0) + 1
  }

  return (
    <TeamContent
      members={members}
      invites={(invitesRes.data ?? []) as WorkspaceInvite[]}
      activityCounts={counts}
    />
  )
}
