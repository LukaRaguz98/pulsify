import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { ServerSettingsContent } from '@/components/dashboard/ServerSettingsContent'

export default async function ServerSettingsPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  return <ServerSettingsContent guildId={guildId} />
}
