import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { authorizeWorkspaceMember } from '@/lib/workspace-auth'
import { getWorkspaceMembers, getWorkspaceServers, enrichWorkspaceServers } from '@/lib/workspace-data'
import { guildIconUrl } from '@/lib/discord'
import type {
  WorkspaceSearchIndex,
  WsIndexIncident,
  WsIndexNote,
  WsIndexTask,
} from '@/lib/workspace-command-palette'
import type { IncidentStatus, Priority, Severity, TaskStatus } from '@/lib/workspace'

// Collaborative tables are bounded to recent rows — enough to make search useful
// without shipping the whole history to the client on every palette open.
const COLLAB_LIMIT = 200

/**
 * GET /api/workspaces/[workspaceId]/search
 *
 * Returns a bounded snapshot ("index") of everything the workspace search can
 * match: linked servers (with live Discord name/icon), team members, and recent
 * notes / tasks / incidents. The client caches this for a short window and
 * fuzzy-matches locally, so per-keystroke typing never hits the network.
 *
 * Gated by workspace membership (same boundary as the workspace area itself).
 * Discord reads ride fetchGuild's data cache, so repeated opens are cheap.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const auth = await authorizeWorkspaceMember(workspaceId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()

  const [enriched, members, noteRes, taskRes, incidentRes] = await Promise.all([
    // EnrichedServer carries the original row (incl. tags) plus live Discord
    // name/icon/memberCount, so it's the only server read we need.
    getWorkspaceServers(workspaceId).then(enrichWorkspaceServers),
    getWorkspaceMembers(workspaceId),
    supabase
      .from('workspace_notes')
      .select('id, body, author_name, pinned')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(COLLAB_LIMIT),
    supabase
      .from('workspace_tasks')
      .select('id, title, status, priority')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(COLLAB_LIMIT),
    supabase
      .from('workspace_incidents')
      .select('id, title, status, severity')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(COLLAB_LIMIT),
  ])

  const index: WorkspaceSearchIndex = {
    servers: enriched.map((e) => ({
      guildId: e.guild_id,
      name: e.name,
      iconUrl: e.icon ? guildIconUrl(e.guild_id, e.icon, 64) : null,
      memberCount: e.memberCount,
      tags: e.tags ?? [],
      botInstalled: e.botInstalled,
    })),
    members: members.map((m) => ({
      userId: m.user_id,
      name: m.display_name ?? 'Member',
      avatar: m.avatar_url,
      role: m.role,
    })),
    notes: ((noteRes.data ?? []) as {
      id: string
      body: string
      author_name: string | null
      pinned: boolean
    }[]).map<WsIndexNote>((n) => ({
      id: n.id,
      body: n.body,
      author: n.author_name,
      pinned: n.pinned,
    })),
    tasks: ((taskRes.data ?? []) as {
      id: string
      title: string
      status: TaskStatus
      priority: Priority
    }[]).map<WsIndexTask>((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
    })),
    incidents: ((incidentRes.data ?? []) as {
      id: string
      title: string
      status: IncidentStatus
      severity: Severity
    }[]).map<WsIndexIncident>((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      severity: i.severity,
    })),
    generatedAt: new Date().toISOString(),
  }

  return NextResponse.json(index)
}
