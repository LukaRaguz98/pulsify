import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, SlidersHorizontal } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { getValidDiscordToken } from '@/lib/discord-session'
import { fetchUserGuilds, hasManageGuild } from '@/lib/discord'
import { getCurrentDiscordUser } from '@/lib/workspace-auth'
import { listUserWorkspaces } from '@/lib/workspace-data'
import { UserProfileButton } from '@/components/dashboard/UserProfileButton'
import { WorkspacePicker, type PickableGuild } from '@/components/workspace/WorkspacePicker'

export default async function WorkspaceHomePage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) redirect('/')

  const actor = await getCurrentDiscordUser()
  if (!actor) redirect('/')

  // The picker's "add servers" step is built from the user's own manageable
  // guilds that already have the bot — same source as the dashboard home.
  const token = await getValidDiscordToken({
    access_token: session.provider_token,
    refresh_token: session.provider_refresh_token,
  })
  let guilds: PickableGuild[] = []
  const [workspaces, syncedRes] = await Promise.all([
    listUserWorkspaces(actor.userId),
    supabase.from('synced_guilds').select('guild_id'),
  ])
  if (token) {
    try {
      const all = await fetchUserGuilds(token)
      const synced = new Set((syncedRes.data ?? []).map((r: { guild_id: string }) => r.guild_id))
      guilds = all
        .filter((g) => hasManageGuild(g.permissions))
        .map((g) => ({ id: g.id, name: g.name, icon: g.icon, botInstalled: synced.has(g.id) }))
        .sort((a, b) => Number(b.botInstalled) - Number(a.botInstalled) || a.name.localeCompare(b.name))
    } catch {
      guilds = []
    }
  }

  const meta = session.user.user_metadata ?? {}
  const claims = meta.custom_claims as { username?: string; global_name?: string; discriminator?: string } | undefined

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="border-b sticky top-0 z-10"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', backdropFilter: 'blur(12px)' }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Pulsify home">
            <Image src="/logo.png" alt="Pulsify" width={34} height={34} className="shrink-0" style={{ filter: 'drop-shadow(0 4px 10px var(--p-glow))' }} />
            <span className="font-bold text-base tracking-tight" style={{ color: 'var(--p-1)' }}>Pulsify</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/preferences"
              title="Preferences"
              aria-label="Preferences"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border transition hover:text-foreground"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <SlidersHorizontal size={15} />
            </Link>
            <UserProfileButton
              displayName={actor.username ?? 'User'}
              username={claims?.username}
              discriminator={claims?.discriminator}
              discordId={actor.userId}
              email={session.user.email}
              avatarUrl={meta.avatar_url ?? ''}
              avatarSize={30}
              popupDirection="down"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
        >
          <ArrowLeft size={12} />
          Back to servers
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Workspaces</h1>
          <p className="mt-1.5 text-muted-foreground">
            Group multiple Discord servers, invite your team, and manage them together.
          </p>
        </div>

        <WorkspacePicker workspaces={workspaces} guilds={guilds} />
      </main>
    </div>
  )
}
