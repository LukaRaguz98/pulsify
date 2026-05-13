import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild } from '@/lib/discord'
import { GuildSidebar } from '@/components/dashboard/GuildSidebar'

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

  const guild = await fetchGuild(guildId)
  if (!guild) redirect('/dashboard')

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <GuildSidebar guild={guild} guildId={guildId} user={session.user} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
