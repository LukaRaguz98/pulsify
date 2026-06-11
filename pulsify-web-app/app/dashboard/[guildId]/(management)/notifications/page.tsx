import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { NotificationsContent } from '@/components/dashboard/NotificationsContent'

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  return <NotificationsContent guildId={guildId} />
}
