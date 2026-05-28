import { createClient } from '@/lib/supabase-server'
import { getWorkspaceServers, enrichWorkspaceServers } from '@/lib/workspace-data'
import { IncidentsContent } from '@/components/workspace/IncidentsContent'
import type { WorkspaceIncident } from '@/lib/workspace'

export default async function WorkspaceIncidentsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const supabase = await createClient()

  const [incidentsRes, servers] = await Promise.all([
    supabase.from('workspace_incidents').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
    getWorkspaceServers(workspaceId),
  ])
  const enriched = await enrichWorkspaceServers(servers)
  const serverNames: Record<string, string> = {}
  for (const s of enriched) serverNames[s.guild_id] = s.name

  return <IncidentsContent initialIncidents={(incidentsRes.data ?? []) as WorkspaceIncident[]} serverNames={serverNames} />
}
