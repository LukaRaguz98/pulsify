import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild } from '@/lib/discord'
import { MembersContent } from '@/components/dashboard/members/MembersContent'

export default async function MembersPage({
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

  return <MembersContent guildId={guildId} guildName={guild.name} />
}
