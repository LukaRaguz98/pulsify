import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getValidDiscordToken } from '@/lib/discord-session'
import { fetchGuild, fetchSelfUser, userBannerUrl } from '@/lib/discord'
import { GuildSidebar } from '@/components/dashboard/GuildSidebar'
import { CornerDecorations } from '@/components/dashboard/CornerDecorations'
import { DiscordCornerIcon } from '@/components/dashboard/DiscordCornerIcon'
import { Footer } from '@/components/Footer'
import { NotificationsProvider } from '@/components/dashboard/notifications/NotificationsProvider'
import { NotificationBell } from '@/components/dashboard/notifications/NotificationBell'
import { Toaster } from '@/components/dashboard/notifications/Toaster'
import { PingIndicator } from '@/components/dashboard/PingIndicator'
import { CommandPaletteProvider } from '@/components/dashboard/search/CommandPaletteProvider'

export default async function GuildLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/')

  const providerToken = await getValidDiscordToken({
    access_token: session.provider_token,
    refresh_token: session.provider_refresh_token,
  })
  const [guild, selfUser] = await Promise.all([
    fetchGuild(guildId),
    providerToken ? fetchSelfUser(providerToken) : null,
  ])
  if (!guild) redirect('/dashboard')

  const discordId = session.user.user_metadata?.provider_id ?? session.user.id
  const bannerUrl = selfUser?.banner ? userBannerUrl(selfUser.id ?? discordId, selfUser.banner) : undefined

  return (
    <NotificationsProvider guildId={guildId}>
      <CommandPaletteProvider guildId={guildId}>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          <GuildSidebar
            guild={guild}
            guildId={guildId}
            user={session.user}
            selfUser={selfUser ?? undefined}
            bannerUrl={bannerUrl}
          />
          <CornerDecorations />
          <DiscordCornerIcon guildId={guildId} />
          <NotificationBell guildId={guildId} />
          <PingIndicator />
          <main className="flex-1 overflow-y-auto flex flex-col">
            {/* max-lg:pt-12 clears the fixed mobile top bar (h-12) rendered by
                GuildSidebar on small screens; desktop has no offset. */}
            <div className="flex-1 max-lg:pt-12">{children}</div>
            <Footer />
          </main>
          <Toaster />
        </div>
      </CommandPaletteProvider>
    </NotificationsProvider>
  )
}
