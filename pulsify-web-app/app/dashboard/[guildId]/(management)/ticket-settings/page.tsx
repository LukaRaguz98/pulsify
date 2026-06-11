import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles, CHANNEL_TYPES } from '@/lib/discord'
import { TicketSettingsContent } from '@/components/dashboard/tickets/TicketSettingsContent'
import { normaliseConfig } from '@/lib/tickets'

// The ticket system's configuration lives here — its own page under the
// Settings nav group — so all server settings are centralised, with a shortcut
// button on the Tickets management view.
export default async function TicketSettingsPage({
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

  const [guild, channels, roles, { data: configRow }] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
    supabase.from('ticket_configs').select('*').eq('guild_id', guildId).maybeSingle(),
  ])

  const textChannels = channels
    .filter((c) => c.type === CHANNEL_TYPES.TEXT || c.type === CHANNEL_TYPES.ANNOUNCEMENT)
    .sort((a, b) => a.position - b.position)
  const categories = channels
    .filter((c) => c.type === CHANNEL_TYPES.CATEGORY)
    .sort((a, b) => a.position - b.position)
  const assignableRoles = roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)

  const config = normaliseConfig(guildId, configRow as Record<string, unknown> | null)

  return (
    <TicketSettingsContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      config={config}
      channels={textChannels}
      categories={categories}
      roles={assignableRoles}
    />
  )
}
