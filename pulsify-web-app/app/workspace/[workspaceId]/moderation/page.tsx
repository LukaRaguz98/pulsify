import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { authorizeWorkspaceMember } from '@/lib/workspace-auth'
import { getWorkspaceServers, enrichWorkspaceServers } from '@/lib/workspace-data'
import { ModerationContent, type ModLogRow } from '@/components/workspace/ModerationContent'
import type { WatchlistEntry } from '@/lib/workspace'

export default async function WorkspaceModerationPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params

  // Page-level gate matching the sidebar's manageWatchlist visibility rule.
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageWatchlist')
  if (!auth.ok) redirect(`/workspace/${workspaceId}`)

  const supabase = await createClient()

  const servers = await getWorkspaceServers(workspaceId)
  const enriched = await enrichWorkspaceServers(servers)
  const serverNames: Record<string, string> = {}
  for (const s of enriched) serverNames[s.guild_id] = s.name
  const guildIds = servers.map((s) => s.guild_id)

  const [logsRes, watchRes] = await Promise.all([
    guildIds.length
      ? supabase.from('moderation_logs').select('id, guild_id, action, target_user_id, target_username, moderator_username, reason, created_at').in('guild_id', guildIds).order('created_at', { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as ModLogRow[] }),
    supabase.from('workspace_watchlist').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
  ])

  return (
    <ModerationContent
      logs={(logsRes.data ?? []) as ModLogRow[]}
      initialWatchlist={(watchRes.data ?? []) as WatchlistEntry[]}
      serverNames={serverNames}
      hasServers={guildIds.length > 0}
    />
  )
}
