import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { EventsContent } from '@/components/dashboard/EventsContent'

export default async function EventsPage({
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

  return <EventsContent guildId={guildId} />
}
