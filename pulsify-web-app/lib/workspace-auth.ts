import 'server-only'
import { createClient as createServerSupabase } from '@/lib/supabase-server'
import { getValidDiscordToken } from '@/lib/discord-session'
import { fetchSelfUser, avatarUrl } from '@/lib/discord'
import { authorizeGuildModerator, type ModeratorContext } from '@/lib/moderation-auth'
import { can, type Capability, type WorkspaceRole } from '@/lib/workspace'

/**
 * Server-side authorization for the workspace / team area (PULSIFY-28),
 * mirroring lib/moderation-auth.ts.
 *
 * HYBRID model: workspace roles fully govern the /workspace area and all
 * Pulsify-internal collaboration data (authorizeWorkspaceMember). Anything that
 * mutates Discord additionally requires the live Discord "Manage Server" check
 * (authorizeWorkspaceGuildAction → also runs authorizeGuildModerator).
 */

export type WorkspaceActor = {
  userId: string
  /** Display name — what goes in titles / activity summaries. */
  username: string | null
  /** Raw @handle. */
  handle: string | null
  /** Discord avatar URL (for storing on the member row), best-effort. */
  avatarUrl: string | null
}

export type WorkspaceAuthResult =
  | { ok: true; actor: WorkspaceActor; role: WorkspaceRole }
  | { ok: false; error: string }

/**
 * Resolve the signed-in Supabase user to their Discord identity WITHOUT any
 * guild membership check. Used when creating a workspace (any signed-in user
 * may) and when accepting an invite. Lifts the identity-extraction block from
 * authorizeGuildModerator so both stay consistent.
 */
export async function getCurrentDiscordUser(): Promise<WorkspaceActor | null> {
  const supabase = await createServerSupabase()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null

  const meta = session.user.user_metadata ?? {}
  const claims = meta.custom_claims as { username?: string; global_name?: string } | undefined

  let userId = (meta.provider_id as string | undefined) ?? session.user.id
  let username = claims?.global_name ?? claims?.username ?? (meta.full_name as string | undefined) ?? null
  let handle = claims?.username ?? null
  let avatar = (meta.avatar_url as string | undefined) ?? null

  // Fall back to the live Discord identity when the cached claims are thin.
  if (!username || !handle || !avatar) {
    const token = await getValidDiscordToken({
      access_token: session.provider_token,
      refresh_token: session.provider_refresh_token,
    })
    if (token) {
      const self = await fetchSelfUser(token)
      if (self) {
        userId = self.id
        username = username ?? self.global_name ?? self.username
        handle = handle ?? self.username
        avatar = avatar ?? avatarUrl(self.id, self.avatar ?? null, self.discriminator ?? '0', 128)
      }
    }
  }

  return { userId, username, handle, avatarUrl: avatar }
}

/** Look up a user's role in a workspace. Null = not a member. */
export async function getWorkspaceRole(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  return (data?.role as WorkspaceRole | undefined) ?? null
}

/**
 * Gate a workspace action: the caller must be signed in, a member of the
 * workspace, and (if a capability is given) hold it for their role.
 */
export async function authorizeWorkspaceMember(
  workspaceId: string,
  capability?: Capability,
): Promise<WorkspaceAuthResult> {
  const actor = await getCurrentDiscordUser()
  if (!actor) return { ok: false, error: 'You must be signed in.' }

  const role = await getWorkspaceRole(workspaceId, actor.userId)
  if (!role) return { ok: false, error: 'You are not a member of this workspace.' }

  if (capability && !can(role, capability)) {
    return { ok: false, error: "Your workspace role doesn't allow that." }
  }

  return { ok: true, actor, role }
}

export type WorkspaceGuildAuthResult =
  | { ok: true; actor: WorkspaceActor; role: WorkspaceRole; moderator: ModeratorContext }
  | { ok: false; error: string }

/**
 * Gate a Discord-MUTATING cross-server action (ban, kick, …). Hybrid model:
 * the caller must (1) be a workspace member with the `moderate` capability AND
 * (2) independently hold Discord Manage Server on the target guild — the
 * existing per-guild boundary is never bypassed by workspace membership.
 */
export async function authorizeWorkspaceGuildAction(
  workspaceId: string,
  guildId: string,
): Promise<WorkspaceGuildAuthResult> {
  const ws = await authorizeWorkspaceMember(workspaceId, 'moderate')
  if (!ws.ok) return ws

  // The guild must actually belong to this workspace, else a member could act
  // on arbitrary servers by passing any guild id.
  const supabase = await createServerSupabase()
  const { data: link } = await supabase
    .from('workspace_servers')
    .select('guild_id')
    .eq('workspace_id', workspaceId)
    .eq('guild_id', guildId)
    .maybeSingle()
  if (!link) return { ok: false, error: 'That server is not part of this workspace.' }

  const mod = await authorizeGuildModerator(guildId)
  if (!mod.ok) {
    return {
      ok: false,
      error: 'You need Discord "Manage Server" on this server to perform that action.',
    }
  }

  return { ok: true, actor: ws.actor, role: ws.role, moderator: mod.moderator }
}
