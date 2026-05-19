import Image from 'next/image'
import { redirect } from 'next/navigation'
import { Activity, Unplug } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { getValidDiscordToken } from '@/lib/discord-session'
import { fetchUserGuilds, fetchSelfUser, hasManageGuild, userBannerUrl, type DiscordGuild } from '@/lib/discord'
import { ServerCard } from '@/components/dashboard/ServerCard'
import { UserProfileButton } from '@/components/dashboard/UserProfileButton'
import { CategorySection } from '@/components/ui/category-section'
import { Footer } from '@/components/Footer'
import { ReconnectDiscordButton } from '@/components/ReconnectDiscordButton'

type GuildWithBot = DiscordGuild & { botInstalled: boolean }

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
      guilds = all
        .filter((g) => hasManageGuild(g.permissions))
        .map((g) => ({ ...g, botInstalled: syncedIds.has(g.id) }))
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

  const active = guilds.filter((g) => g.botInstalled)
  const notConnected = guilds.filter((g) => !g.botInstalled)

  return (
    // flex-col + main with flex-1 pins the Footer to the viewport bottom on
    // short pages instead of letting it float mid-screen below the content.
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b sticky top-0 z-10" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', backdropFilter: 'blur(12px)' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="Pulsify"
              width={34}
              height={34}
              className="shrink-0"
              style={{ filter: 'drop-shadow(0 4px 10px var(--p-glow))' }}
            />
            <span className="font-bold text-base tracking-tight" style={{ color: 'var(--p-1)' }}>Pulsify</span>
          </div>

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
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Welcome back, {displayName.split(' ')[0]}
          </h1>
          <p className="mt-1.5 text-muted-foreground">
            Select a Discord server to manage with Pulsify.
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
