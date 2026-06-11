import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Activity, Unplug, Building2, SlidersHorizontal, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { getValidDiscordToken } from '@/lib/discord-session'
import { fetchUserGuilds, fetchSelfUser, hasManageGuild, userBannerUrl, type DiscordGuild } from '@/lib/discord'
import { ServerCard } from '@/components/dashboard/ServerCard'
import { UserProfileButton } from '@/components/dashboard/UserProfileButton'
import { CategorySection } from '@/components/ui/category-section'
import { highlightBrand } from '@/components/ui/brand-text'
import { Footer } from '@/components/Footer'
import { ReconnectDiscordButton } from '@/components/ReconnectDiscordButton'

type GuildWithBot = DiscordGuild & { botInstalled: boolean; canManage: boolean }

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/')

  const providerToken = await getValidDiscordToken({
    access_token: session.provider_token,
    refresh_token: session.provider_refresh_token,
  })
  let guilds: GuildWithBot[] = []
  let tokenMissing = false
  let discordError = false

  const user = session.user
  const claims = user.user_metadata?.custom_claims
  const discordId = user.user_metadata?.provider_id ?? user.id

  let selfUser = null
  if (!providerToken) {
    tokenMissing = true
  } else {
    const [allResult, { data: syncedRows }, self] = await Promise.allSettled([
      fetchUserGuilds(providerToken),
      supabase.from('synced_guilds').select('guild_id'),
      fetchSelfUser(providerToken),
    ]).then(([guildsR, syncedR, selfR]) => [
      guildsR,
      syncedR.status === 'fulfilled' ? syncedR.value : { data: [] },
      selfR.status === 'fulfilled' ? selfR.value : null,
    ] as const)
    selfUser = self
    if (allResult.status === 'fulfilled') {
      const all = allResult.value
      const syncedIds = new Set((syncedRows ?? []).map((r: { guild_id: string }) => r.guild_id))
      // Pulsify is no longer admin-only (PULSIFY-45): manageable servers are
      // listed as before, and servers where the user is just a member show up
      // too (read-only member experience) — but only once Pulse is installed.
      guilds = all
        .map((g) => ({
          ...g,
          botInstalled: syncedIds.has(g.id),
          canManage: hasManageGuild(g.permissions),
        }))
        .filter((g) => g.canManage || g.botInstalled)
    } else {
      discordError = true
    }
  }

  const displayName =
    selfUser?.global_name ??
    claims?.global_name ??
    selfUser?.username ??
    user.user_metadata?.full_name ??
    user.email ??
    'User'
  const userAvatar = user.user_metadata?.avatar_url ?? ''
  const username = selfUser?.username ?? claims?.username
  const discriminator = selfUser?.discriminator ?? claims?.discriminator
  const bannerUrl = selfUser?.banner ? userBannerUrl(selfUser.id, selfUser.banner) : ''
  const bannerColor = selfUser?.banner_color ?? undefined

  const active = guilds.filter((g) => g.botInstalled && g.canManage)
  const notConnected = guilds.filter((g) => !g.botInstalled && g.canManage)
  // Servers the user belongs to without management permissions — the
  // read-only member experience (profile, leaderboards, economy, …).
  const communities = guilds.filter((g) => g.botInstalled && !g.canManage)

  return (
    // flex-col + main with flex-1 pins the Footer to the viewport bottom on
    // short pages instead of letting it float mid-screen below the content.
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b sticky top-0 z-10" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', backdropFilter: 'blur(12px)' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Pulsify home">
            <Image
              src="/logo.png"
              alt="Pulsify"
              width={34}
              height={34}
              className="shrink-0"
              style={{ filter: 'drop-shadow(0 4px 10px var(--p-glow))' }}
            />
            <span className="font-bold text-base tracking-tight" style={{ color: 'var(--p-1)' }}>Pulsify</span>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/workspace"
              title="Workspaces"
              aria-label="Workspaces"
              // On phones the label is dropped and the control collapses to a
              // square icon button (matching Preferences) to save header space.
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:text-foreground max-sm:h-8 max-sm:w-8 max-sm:justify-center max-sm:gap-0 max-sm:p-0"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <Building2 size={15} />
              <span className="hidden sm:inline">Workspaces</span>
            </Link>
            <Link
              href="/preferences"
              title="Preferences"
              aria-label="Preferences"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border transition hover:text-foreground"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <SlidersHorizontal size={15} />
            </Link>
            {/* Small right margin so the avatar isn't flush against the edge. */}
            <div className="mr-1">
              <UserProfileButton
                displayName={displayName}
                username={username}
                discriminator={discriminator}
                discordId={discordId}
                email={user.email}
                avatarUrl={userAvatar}
                bannerUrl={bannerUrl || undefined}
                bannerColor={bannerColor}
                avatarSize={30}
                popupDirection="down"
              />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Welcome back, {displayName.split(' ')[0]}
          </h1>
          <p className="mt-1.5 text-muted-foreground">
            {highlightBrand('Select a Discord server to manage with Pulsify.')}
          </p>
        </div>

        {tokenMissing && (
          <div
            className="mb-8 rounded-xl p-5 border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            style={{ background: 'rgba(245,158,11,0.07)', borderColor: 'rgba(245,158,11,0.25)' }}
          >
            <div>
              <p className="font-medium text-amber-400">Discord session expired</p>
              <p className="mt-1 text-sm" style={{ color: 'rgba(245,158,11,0.7)' }}>
                Your Discord access token couldn&apos;t be refreshed. Reconnect to keep using Pulsify — you&apos;ll stay signed in.
              </p>
            </div>
            <ReconnectDiscordButton redirectAfter="/dashboard" />
          </div>
        )}

        {discordError && (
          <div
            className="mb-8 rounded-xl p-5 border"
            style={{ background: 'rgba(239,68,68,0.07)', borderColor: 'rgba(239,68,68,0.25)' }}
          >
            <p className="font-medium text-red-400">Couldn&apos;t reach Discord</p>
            <p className="mt-1 text-sm" style={{ color: 'rgba(239,68,68,0.7)' }}>
              We couldn&apos;t load your servers from Discord just now. Refresh the page to retry.
            </p>
          </div>
        )}

        {active.length > 0 && (
          <div className="mb-10">
            <CategorySection
              icon={<Activity size={14} />}
              title="Active Servers"
              description={`${active.length} server${active.length === 1 ? '' : 's'} where Pulse is installed and ready to manage.`}
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {active.map((guild) => (
                  <ServerCard key={guild.id} guild={guild} />
                ))}
              </div>
            </CategorySection>
          </div>
        )}

        {communities.length > 0 && (
          <div className="mb-10">
            <CategorySection
              icon={<UsersRound size={14} />}
              title="Your Communities"
              description={`${communities.length} server${communities.length === 1 ? '' : 's'} you're a member of — view your profile, reputation, leaderboards and more.`}
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {communities.map((guild) => (
                  <ServerCard key={guild.id} guild={guild} memberAccess />
                ))}
              </div>
            </CategorySection>
          </div>
        )}

        {notConnected.length > 0 && (
          <CategorySection
            icon={<Unplug size={14} />}
            title="Not Connected"
            description={`${notConnected.length} server${notConnected.length === 1 ? '' : 's'} you manage that don't have Pulse yet.`}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {notConnected.map((guild) => (
                <ServerCard key={guild.id} guild={guild} />
              ))}
            </div>
          </CategorySection>
        )}

        {!tokenMissing && guilds.length === 0 && (
          <div
            className="flex flex-col items-center justify-center rounded-xl border py-20 text-center"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            <p className="text-lg font-semibold text-foreground">No servers found</p>
            <p className="mt-2 text-sm text-subtle max-w-sm">
              You don&apos;t manage any Discord servers, or you need to grant server permissions.
            </p>
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
