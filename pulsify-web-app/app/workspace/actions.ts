'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { getCurrentDiscordUser } from '@/lib/workspace-auth'
import { recordWorkspaceActivity } from '@/lib/workspace-activity'
import { slugify, isWorkspaceRole } from '@/lib/workspace'
import { getUserPlan } from '@/lib/billing-server'
import { PLAN_LIMITS } from '@/lib/billing'
import { listUserWorkspaces } from '@/lib/workspace-data'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

const NAME_MAX = 60

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6)
}

/** Find a free slug for `name`, appending a short random suffix on collision. */
async function uniqueSlug(supabase: Awaited<ReturnType<typeof createClient>>, name: string): Promise<string> {
  const base = slugify(name)
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`
    const { data } = await supabase.from('workspaces').select('id').eq('slug', candidate).maybeSingle()
    if (!data) return candidate
  }
  return `${base}-${randomSuffix()}${randomSuffix()}`
}

/**
 * Create a workspace. Any signed-in user may. The creator becomes the owner
 * (workspaces.owner_id + a workspace_members 'owner' row). Optional guildIds
 * seed the first servers (the onboarding wizard passes the user's picks).
 */
export async function createWorkspace(input: {
  name: string
  accent?: string
  guildIds?: string[]
}): Promise<ActionResult<{ id: string; slug: string }>> {
  const actor = await getCurrentDiscordUser()
  if (!actor) return { ok: false, error: 'You must be signed in.' }

  const name = input.name.trim().slice(0, NAME_MAX)
  if (!name) return { ok: false, error: 'Workspace name is required.' }

  // Per-plan workspace cap. Owned (not just member-of) workspaces count
  // toward the limit so Business teams can collaborate without each member
  // tripping the gate. The picker UI mirrors this — see WorkspacePicker.
  const plan = await getUserPlan(actor.userId)
  const limit = PLAN_LIMITS[plan].maxWorkspaces
  const owned = await listUserWorkspaces(actor.userId)
  const ownedCount = owned.filter((w) => w.owner_id === actor.userId).length
  if (ownedCount >= limit) {
    return {
      ok: false,
      error: `Your plan allows ${limit} workspace${limit === 1 ? '' : 's'}. Upgrade to create more.`,
    }
  }

  // Per-plan server cap on the FIRST seed. Adding more servers later is
  // gated separately in addServer.
  const seedCount = (input.guildIds ?? []).length
  const serverLimit = PLAN_LIMITS[plan].maxServersPerWorkspace
  if (seedCount > serverLimit) {
    return {
      ok: false,
      error: `Your plan allows ${serverLimit} server${serverLimit === 1 ? '' : 's'} per workspace.`,
    }
  }

  const supabase = await createClient()
  const slug = await uniqueSlug(supabase, name)

  const { data: workspace, error } = await supabase
    .from('workspaces')
    .insert({
      name,
      slug,
      owner_id: actor.userId,
      settings: input.accent ? { accent: input.accent } : {},
    })
    .select('id, slug')
    .single()
  if (error || !workspace) {
    return { ok: false, error: error?.message ?? 'Could not create the workspace.' }
  }

  const { error: memberError } = await supabase.from('workspace_members').insert({
    workspace_id: workspace.id,
    user_id: actor.userId,
    role: 'owner',
    display_name: actor.username,
    avatar_url: actor.avatarUrl,
  })
  if (memberError) {
    // Roll back the orphaned workspace so the user can retry cleanly.
    await supabase.from('workspaces').delete().eq('id', workspace.id)
    return { ok: false, error: 'Could not set up workspace ownership.' }
  }

  // Seed the picked servers. We only require that the bot is present
  // (synced_guilds); the picker is built from the user's own manageable guilds,
  // so a Manage-Server check already happened when the list was rendered.
  const guildIds = (input.guildIds ?? []).filter(Boolean).slice(0, 50)
  if (guildIds.length > 0) {
    await supabase.from('workspace_servers').insert(
      guildIds.map((guild_id) => ({
        workspace_id: workspace.id,
        guild_id,
        added_by: actor.userId,
      })),
    )
  }

  await recordWorkspaceActivity({
    workspaceId: workspace.id,
    actorId: actor.userId,
    actorName: actor.username,
    action: 'workspace.created',
    summary: `${actor.username ?? 'Someone'} created the workspace${guildIds.length ? ` with ${guildIds.length} server${guildIds.length === 1 ? '' : 's'}` : ''}`,
  })

  revalidatePath('/workspace')
  return { ok: true, data: { id: workspace.id, slug: workspace.slug } }
}

/**
 * Accept a workspace invite by code. The invitee must be signed in; their
 * Discord identity becomes a workspace_members row with the invite's role.
 * Idempotent for existing members (returns ok without changing their role).
 */
export async function acceptInvite(code: string): Promise<ActionResult<{ workspaceId: string }>> {
  const actor = await getCurrentDiscordUser()
  if (!actor) return { ok: false, error: 'You must be signed in to accept an invite.' }

  const supabase = await createClient()
  const { data: invite } = await supabase
    .from('workspace_invites')
    .select('*')
    .eq('code', code)
    .maybeSingle()
  if (!invite) return { ok: false, error: 'This invite link is invalid.' }
  if (invite.revoked) return { ok: false, error: 'This invite has been revoked.' }
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'This invite has expired.' }
  }
  if (invite.max_uses != null && invite.uses >= invite.max_uses) {
    return { ok: false, error: 'This invite has reached its maximum uses.' }
  }

  // Already a member? No-op, just send them in.
  const { data: existing } = await supabase
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', invite.workspace_id)
    .eq('user_id', actor.userId)
    .maybeSingle()
  if (existing) return { ok: true, data: { workspaceId: invite.workspace_id } }

  const role = isWorkspaceRole(invite.role) ? invite.role : 'support'
  const { error: insertError } = await supabase.from('workspace_members').insert({
    workspace_id: invite.workspace_id,
    user_id: actor.userId,
    role,
    display_name: actor.username,
    avatar_url: actor.avatarUrl,
    added_by: invite.created_by,
  })
  if (insertError) return { ok: false, error: 'Could not join the workspace.' }

  await supabase
    .from('workspace_invites')
    .update({ uses: invite.uses + 1 })
    .eq('id', invite.id)

  await recordWorkspaceActivity({
    workspaceId: invite.workspace_id,
    actorId: actor.userId,
    actorName: actor.username,
    action: 'member.joined',
    targetType: 'member',
    targetId: actor.userId,
    summary: `${actor.username ?? 'Someone'} joined as ${role}`,
  })

  revalidatePath('/workspace')
  return { ok: true, data: { workspaceId: invite.workspace_id } }
}
