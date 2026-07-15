import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, CHANNEL_TYPES } from '@/lib/discord'
import { normaliseInviteSettings } from '@/lib/invites'
import { InviteSettings } from '@/components/dashboard/invites/InviteSettings'

/**
 * Invite configuration — a sibling of the Invites view (reached from its
 * top-right "Invite settings" button, same pattern as Birthdays →
 * /birthday-settings). GuildSidebar keeps "Invites" highlighted here via
 * matchPrefixes: ['/invite-settings'].
 */
export default async function InviteSettingsPage({
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

  const [guild, channels, { data: row }] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    supabase.from('invite_settings').select('enabled, settings').eq('guild_id', guildId).maybeSingle(),
  ])
  if (!guild) redirect('/dashboard')

  const textChannels = channels
    .filter((c) => c.type === CHANNEL_TYPES.TEXT || c.type === CHANNEL_TYPES.ANNOUNCEMENT)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }))

  const config = normaliseInviteSettings(row ?? null)

  return <InviteSettings guildId={guildId} guildName={guild.name} config={config} channels={textChannels} />
}
