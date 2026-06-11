import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { ChannelsContent } from '@/components/dashboard/ChannelsContent'

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  return <ChannelsContent guildId={guildId} />
}
