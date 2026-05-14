import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild } from '@/lib/discord'
import { StatisticsContent } from '@/components/dashboard/StatisticsContent'

export default async function StatisticsPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const guild = await fetchGuild(guildId)
  if (!guild) redirect('/dashboard')

  return <StatisticsContent guildId={guildId} guildName={guild.name} />
}
