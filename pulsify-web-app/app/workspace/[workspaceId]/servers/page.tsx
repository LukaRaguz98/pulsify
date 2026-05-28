import { createClient } from '@/lib/supabase-server'
import { getValidDiscordToken } from '@/lib/discord-session'
import { fetchUserGuilds, hasManageGuild } from '@/lib/discord'
import { getWorkspaceServers, enrichWorkspaceServers } from '@/lib/workspace-data'
import { ServersContent } from '@/components/workspace/ServersContent'
import type { PickableGuild } from '@/components/workspace/WorkspacePicker'

export default async function WorkspaceServersPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const supabase = await createClient()

  const servers = await getWorkspaceServers(workspaceId)
  const enriched = await enrichWorkspaceServers(servers)

  // Servers the user manages on Discord that aren't already in the workspace.
  const existing = new Set(servers.map((s) => s.guild_id))
  let available: PickableGuild[] = []
  const { data: { session } } = await supabase.auth.getSession()
  const token = session ? await getValidDiscordToken({
    access_token: session.provider_token,
    refresh_token: session.provider_refresh_token,
  }) : null
  if (token) {
    try {
      const [all, syncedRes] = await Promise.all([
        fetchUserGuilds(token),
        supabase.from('synced_guilds').select('guild_id'),
      ])
      const synced = new Set((syncedRes.data ?? []).map((r: { guild_id: string }) => r.guild_id))
      available = all
        .filter((g) => hasManageGuild(g.permissions) && !existing.has(g.id))
        .map((g) => ({ id: g.id, name: g.name, icon: g.icon, botInstalled: synced.has(g.id) }))
        .sort((a, b) => Number(b.botInstalled) - Number(a.botInstalled) || a.name.localeCompare(b.name))
    } catch {
      available = []
    }
  }

  return <ServersContent servers={enriched} available={available} />
}
