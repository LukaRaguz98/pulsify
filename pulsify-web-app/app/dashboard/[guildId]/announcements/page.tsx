import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, CHANNEL_TYPES } from '@/lib/discord'
import { AnnouncementsContent } from '@/components/dashboard/announcements/AnnouncementsContent'
import { normaliseAnnouncement, type Announcement } from '@/lib/announcements'

export default async function AnnouncementsPage({
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
