import 'server-only'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild } from '@/lib/discord'
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceServer,
  WorkspaceRole,
  WorkspaceSummary,
  EnrichedServer,
} from '@/lib/workspace'

/**
 * Server-only read helpers for the workspace area. These do NOT enforce access
 * — the caller (a server component / action) gates first with
 * lib/workspace-auth. Pure DB reads; no Discord round-trips (per the insights
 * rate-limit lesson, keep reads cheap).
 */

/** Workspaces the given Discord user belongs to, with their role + counts. */
export async function listUserWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  const supabase = await createClient()
  const { data: memberships } = await supabase
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', userId)
  if (!memberships || memberships.length === 0) return []

  const ids = memberships.map((m) => m.workspace_id)
  const roleById = new Map(memberships.map((m) => [m.workspace_id, m.role as WorkspaceRole]))

  const [{ data: workspaces }, { data: allMembers }, { data: allServers }] = await Promise.all([
    supabase.from('workspaces').select('*').in('id', ids),
    supabase.from('workspace_members').select('workspace_id').in('workspace_id', ids),
    supabase.from('workspace_servers').select('workspace_id').in('workspace_id', ids),
  ])

  const memberCount = new Map<string, number>()
  for (const m of allMembers ?? []) memberCount.set(m.workspace_id, (memberCount.get(m.workspace_id) ?? 0) + 1)
  const serverCount = new Map<string, number>()
  for (const s of allServers ?? []) serverCount.set(s.workspace_id, (serverCount.get(s.workspace_id) ?? 0) + 1)

  return (workspaces ?? [])
    .map((w) => ({
      ...(w as Workspace),
      role: roleById.get(w.id) ?? 'support',
      member_count: memberCount.get(w.id) ?? 0,
      server_count: serverCount.get(w.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function getWorkspace(workspaceId: string): Promise<Workspace | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('workspaces').select('*').eq('id', workspaceId).maybeSingle()
  return (data as Workspace | null) ?? null
}

export async function getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('workspace_members')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('joined_at', { ascending: true })
  return (data as WorkspaceMember[] | null) ?? []
}

export async function getWorkspaceServers(workspaceId: string): Promise<WorkspaceServer[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('workspace_servers')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
  return (data as WorkspaceServer[] | null) ?? []
}

/**
 * Attach live Discord name / icon / member count to each workspace server.
 * fetchGuild is cached (next.revalidate) so repeated overview/servers renders
 * don't hammer Discord. Guilds the bot can't see resolve to a placeholder.
 */
export async function enrichWorkspaceServers(servers: WorkspaceServer[]): Promise<EnrichedServer[]> {
  if (servers.length === 0) return []
  const supabase = await createClient()
  const { data: synced } = await supabase.from('synced_guilds').select('guild_id')
  const syncedSet = new Set((synced ?? []).map((r: { guild_id: string }) => r.guild_id))

  const guilds = await Promise.all(servers.map((s) => fetchGuild(s.guild_id).catch(() => null)))
  return servers.map((s, i) => {
    const g = guilds[i]
    return {
      ...s,
      name: g?.name ?? 'Unknown server',
      icon: g?.icon ?? null,
      memberCount: g?.approximate_member_count ?? g?.member_count ?? null,
      botInstalled: syncedSet.has(s.guild_id),
    }
  })
}
