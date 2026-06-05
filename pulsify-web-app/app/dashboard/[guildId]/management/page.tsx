import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild } from '@/lib/discord'
import { ManagementContent } from '@/components/dashboard/management/ManagementContent'

export default async function ManagementPage({
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

  return <ManagementContent guildId={guildId} guildName={guild.name} />
}
