import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getGuildAccess } from '@/lib/guild-access'
import { fetchGuild, fetchGuildChannels, CHANNEL_TYPES } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { AnnouncementsContent } from '@/components/dashboard/announcements/AnnouncementsContent'
import { MemberAnnouncements } from '@/components/dashboard/member-view/MemberAnnouncements'
import { normaliseAnnouncement, type Announcement } from '@/lib/announcements'

export default async function AnnouncementsPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')
  const supabase = await createClient()

  // Members get the published feed only; the composer (drafts, scheduling,
  // publishing) stays a management surface.
  if (access.effectiveRole === 'member') {
    const [guild, { data: rows }] = await Promise.all([
      fetchGuild(guildId),
      supabase
        .from('announcements')
        .select('*')
        .eq('guild_id', guildId)
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    if (!guild) redirect('/dashboard')
    const announcements: Announcement[] = (rows ?? []).map((r) =>
      normaliseAnnouncement(r as Record<string, unknown>),
    )
    return (
      <div className="page-content">
        <PageHeader
          title="Announcements"
          helpId="announcements"
          description={
            <>
              Announcements published by the{' '}
              <span className="font-medium text-foreground">{guild.name}</span> team
            </>
          }
        />
        <MemberAnnouncements announcements={announcements} />
      </div>
    )
  }

  const [guild, channels, { data: rows }] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    supabase
      .from('announcements')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const textChannels = channels
    .filter((c) => c.type === CHANNEL_TYPES.TEXT || c.type === CHANNEL_TYPES.ANNOUNCEMENT)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }))

  const announcements: Announcement[] = (rows ?? []).map((r) =>
    normaliseAnnouncement(r as Record<string, unknown>),
  )

  return (
    <AnnouncementsContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      initialAnnouncements={announcements}
      channels={textChannels}
    />
  )
}
