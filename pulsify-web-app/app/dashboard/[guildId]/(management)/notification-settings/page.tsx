import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { NotificationSettingsContent } from '@/components/dashboard/notifications/NotificationSettingsContent'

// Notification preferences, reached from the bell dropdown's gear (no longer a
// tab inside Preferences). The page is client-driven via NotificationsProvider,
// which the dashboard layout already wraps around every guild route.
export default async function NotificationSettingsPage({
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

  return <NotificationSettingsContent guildId={guildId} />
}
