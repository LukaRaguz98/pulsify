import { createClient } from '@/lib/supabase-server'
import { getWorkspaceServers, enrichWorkspaceServers } from '@/lib/workspace-data'
import { NotesContent } from '@/components/workspace/NotesContent'
import type { WorkspaceNote } from '@/lib/workspace'

export default async function WorkspaceNotesPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const supabase = await createClient()

  const [notesRes, servers] = await Promise.all([
    supabase.from('workspace_notes').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
    getWorkspaceServers(workspaceId),
  ])
  const enriched = await enrichWorkspaceServers(servers)
  const serverNames: Record<string, string> = {}
  for (const s of enriched) serverNames[s.guild_id] = s.name

  return (
    <NotesContent
      initialNotes={(notesRes.data ?? []) as WorkspaceNote[]}
      serverNames={serverNames}
    />
  )
}
