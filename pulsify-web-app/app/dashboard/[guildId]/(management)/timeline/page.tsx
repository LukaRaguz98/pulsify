import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { TimelineContent } from '@/components/dashboard/timeline/TimelineContent'

/**
 * Analytics › History (PULSIFY-63). Route, tables and types keep the
 * `timeline` name — only the user-facing label changed.
 *
 * A thin shell on purpose: the feed is paginated, filtered and searched from
 * the client against `/api/guilds/[guildId]/timeline`, so server-rendering a
 * first page would only be thrown away the moment a filter changed. Access is
 * enforced by the (management) route group and re-checked in the API.
 */
export default async function TimelinePage({
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

  return <TimelineContent guildId={guildId} />
}
