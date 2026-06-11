import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild } from '@/lib/discord'
import { InsightsContent } from '@/components/dashboard/insights/InsightsContent'

export default async function InsightsPage({
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

  return <InsightsContent guildId={guildId} guildName={guild.name} />
}
