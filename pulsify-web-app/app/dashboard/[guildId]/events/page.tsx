import { redirect } from 'next/navigation'
import { getGuildAccess } from '@/lib/guild-access'
import { fetchGuild, fetchGuildEvents, type DiscordScheduledEvent } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { EventsContent } from '@/components/dashboard/EventsContent'
import { MemberEvents } from '@/components/dashboard/member-view/MemberEvents'

export default async function EventsPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  // Members get a read-only schedule; admins keep the full management view.
  if (access.effectiveRole === 'member') {
    const [guild, events] = await Promise.all([
      fetchGuild(guildId),
      fetchGuildEvents(guildId).catch(() => [] as DiscordScheduledEvent[]),
    ])
    if (!guild) redirect('/dashboard')
    return (
      <div className="page-content">
        <PageHeader
          title="Events"
          helpId="events"
          description={
            <>
              Upcoming and live events in{' '}
              <span className="font-medium text-foreground">{guild.name}</span> — RSVP from the
              Events tab in Discord
            </>
          }
        />
        <MemberEvents events={events} />
      </div>
    )
  }

  return <EventsContent guildId={guildId} />
}
