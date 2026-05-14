import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchSelfUser, userBannerUrl } from '@/lib/discord'
import { GuildSidebar } from '@/components/dashboard/GuildSidebar'
import { CornerDecorations } from '@/components/dashboard/CornerDecorations'

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

  const [guild, selfUser] = await Promise.all([
    fetchGuild(guildId),
    session.provider_token ? fetchSelfUser(session.provider_token) : null,
  ])
  if (!guild) redirect('/dashboard')

  const discordId = session.user.user_metadata?.provider_id ?? session.user.id
  const bannerUrl = selfUser?.banner ? userBannerUrl(selfUser.id ?? discordId, selfUser.banner) : undefined

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <GuildSidebar
        guild={guild}
        guildId={guildId}
        user={session.user}
        selfUser={selfUser ?? undefined}
        bannerUrl={bannerUrl}
      />
      <CornerDecorations />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
