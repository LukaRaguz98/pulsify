'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { getValidDiscordToken } from '@/lib/discord-session'
import { fetchUserGuilds, hasManageGuild, fetchGuild } from '@/lib/discord'
import { authorizeWorkspaceMember, getCurrentDiscordUser } from '@/lib/workspace-auth'
import { recordWorkspaceActivity } from '@/lib/workspace-activity'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(workspaceId: string) {
  revalidatePath(`/workspace/${workspaceId}/servers`)
  revalidatePath(`/workspace/${workspaceId}`)
}

/**
 * Add Discord servers to the workspace. Requires the manageServers capability;
 * additionally each guild must be one the actor actually has Manage Server on
 * (we never let a workspace add a server its members don't control).
 */
export async function addServers(workspaceId: string, guildIds: string[]): Promise<ActionResult<{ added: number }>> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageServers')
  if (!auth.ok) return auth

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const token = session ? await getValidDiscordToken({
    access_token: session.provider_token,
    refresh_token: session.provider_refresh_token,
  }) : null
  if (!token) return { ok: false, error: 'Your Discord session expired — please reconnect.' }

  let manageable: Set<string>
  try {
    const guilds = await fetchUserGuilds(token)
    manageable = new Set(guilds.filter((g) => hasManageGuild(g.permissions)).map((g) => g.id))
  } catch {
    return { ok: false, error: "Couldn't verify your Discord servers. Try again in a moment." }
  }

  const allowed = guildIds.filter((id) => manageable.has(id)).slice(0, 50)
  if (allowed.length === 0) return { ok: false, error: 'You can only add servers you manage on Discord.' }

  const { error } = await supabase
    .from('workspace_servers')
    .upsert(
      allowed.map((guild_id) => ({ workspace_id: workspaceId, guild_id, added_by: auth.actor.userId })),
      { onConflict: 'workspace_id,guild_id', ignoreDuplicates: true },
    )
  if (error) return { ok: false, error: 'Could not add the servers.' }

  await recordWorkspaceActivity({
    workspaceId,
    actorId: auth.actor.userId,
    actorName: auth.actor.username,
    action: 'server.added',
    summary: `${auth.actor.username ?? 'Someone'} added ${allowed.length} server${allowed.length === 1 ? '' : 's'}`,
    metadata: { guildIds: allowed },
  })

  revalidate(workspaceId)
  return { ok: true, data: { added: allowed.length } }
}

export async function removeServer(workspaceId: string, guildId: string): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageServers')
  if (!auth.ok) return auth

  const supabase = await createClient()
  const { error } = await supabase
    .from('workspace_servers')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: 'Could not remove the server.' }

  const guild = await fetchGuild(guildId).catch(() => null)
  await recordWorkspaceActivity({
    workspaceId,
    actorId: auth.actor.userId,
    actorName: auth.actor.username,
    action: 'server.removed',
    guildId,
    summary: `${auth.actor.username ?? 'Someone'} removed ${guild?.name ?? 'a server'}`,
  })

  revalidate(workspaceId)
  return { ok: true }
}

export async function updateServerTags(workspaceId: string, guildId: string, tags: string[]): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'manageServers')
  if (!auth.ok) return auth

  const clean = [...new Set(tags.map((t) => t.trim().slice(0, 24)).filter(Boolean))].slice(0, 8)
  const supabase = await createClient()
  const { error } = await supabase
    .from('workspace_servers')
    .update({ tags: clean })
    .eq('workspace_id', workspaceId)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: 'Could not update tags.' }

  revalidate(workspaceId)
  return { ok: true }
}
