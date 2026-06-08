import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getValidDiscordToken } from '@/lib/discord-session'
import { fetchSelfUser, userBannerUrl } from '@/lib/discord'
import { authorizeWorkspaceMember } from '@/lib/workspace-auth'
import { getWorkspace, getWorkspaceMembers, getWorkspaceServers, listUserWorkspaces } from '@/lib/workspace-data'
import { WorkspaceProvider } from '@/components/workspace/WorkspaceProvider'
import { WorkspaceCommandPaletteProvider } from '@/components/workspace/search/WorkspaceCommandPaletteProvider'
import { WorkspaceSidebar } from '@/components/workspace/WorkspaceSidebar'
import { WorkspaceNotificationBell } from '@/components/workspace/WorkspaceNotificationBell'
import { WorkspaceDiscordCornerIcon } from '@/components/workspace/WorkspaceDiscordCornerIcon'
import { CornerDecorations } from '@/components/dashboard/CornerDecorations'
import { Footer } from '@/components/Footer'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params

  // Membership gate. Non-members (and signed-out users) are bounced to the
  // workspace picker rather than shown a 403 — the hybrid model means access is
  // purely workspace-membership here, no Discord check.
  const auth = await authorizeWorkspaceMember(workspaceId)
  if (!auth.ok) redirect('/workspace')

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  const [workspace, members, servers, workspaces] = await Promise.all([
    getWorkspace(workspaceId),
    getWorkspaceMembers(workspaceId),
    getWorkspaceServers(workspaceId),
    listUserWorkspaces(auth.actor.userId),
  ])
  if (!workspace) redirect('/workspace')

  const meta = session?.user.user_metadata ?? {}
  const claims = meta.custom_claims as
    | { username?: string; discriminator?: string; global_name?: string }
    | undefined

  // Fetch the live Discord self user so the profile card matches the guild
  // dashboard's — username, discriminator and banner all come from here. The
  // workspace itself is membership-gated (no Discord check), so this is a
  // best-effort enrichment: if there's no provider token we fall back to the
  // session's stored claims.
  const providerToken = session
    ? await getValidDiscordToken({
        access_token: session.provider_token,
        refresh_token: session.provider_refresh_token,
      })
    : null
  const selfUser = providerToken ? await fetchSelfUser(providerToken) : null
  const bannerUrl = selfUser?.banner
    ? userBannerUrl(selfUser.id ?? auth.actor.userId, selfUser.banner)
    : undefined

  const displayName =
    selfUser?.global_name ??
    claims?.global_name ??
    selfUser?.username ??
    auth.actor.username ??
    'User'

  return (
    <WorkspaceProvider
      workspace={workspace}
      role={auth.role}
      meId={auth.actor.userId}
      members={members}
      servers={servers}
    >
      <WorkspaceCommandPaletteProvider workspaceId={workspaceId} role={auth.role}>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <WorkspaceSidebar
          workspace={workspace}
          role={auth.role}
          workspaces={workspaces}
          user={{
            displayName,
            username: selfUser?.username ?? claims?.username,
            discriminator: selfUser?.discriminator ?? claims?.discriminator,
            discordId: auth.actor.userId,
            email: session?.user.email,
            avatarUrl: auth.actor.avatarUrl ?? undefined,
            bannerUrl,
            bannerColor: selfUser?.banner_color ?? undefined,
          }}
        />
        <CornerDecorations />
        <WorkspaceDiscordCornerIcon />
        <WorkspaceNotificationBell workspaceId={workspaceId} />
        {/* overflow-x-hidden: matches the guild dashboard — `overflow-y-auto`
            alone computes overflow-x to `auto`, which let pages drag sideways on
            mobile. Clip the cross-axis; wide children keep their own scroll. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col">
          <div className="flex-1 max-lg:pt-12">{children}</div>
          <Footer />
        </main>
      </div>
      </WorkspaceCommandPaletteProvider>
    </WorkspaceProvider>
  )
}
