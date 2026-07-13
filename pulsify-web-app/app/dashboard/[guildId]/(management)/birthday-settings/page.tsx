import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles, CHANNEL_TYPES } from '@/lib/discord'
import { normaliseBirthdaySettings } from '@/lib/birthdays'
import { BirthdaySettings } from '@/components/dashboard/birthdays/BirthdaySettings'

/**
 * Birthday configuration — a sibling of the Birthdays view (reached from its
 * top-right "Birthday settings" button, same pattern as Members →
 * /leveling-settings). GuildSidebar keeps "Birthdays" highlighted here via
 * matchPrefixes: ['/birthday-settings'].
 */
export default async function BirthdaySettingsPage({
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

  const [guild, channels, roles, { data: row }] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
    supabase.from('birthday_settings').select('enabled, settings').eq('guild_id', guildId).maybeSingle(),
  ])
  if (!guild) redirect('/dashboard')

  const textChannels = channels
    .filter((c) => c.type === CHANNEL_TYPES.TEXT || c.type === CHANNEL_TYPES.ANNOUNCEMENT)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }))
  const assignableRoles = roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }))

  const config = normaliseBirthdaySettings(row ?? null)

  return (
    <BirthdaySettings
      guildId={guildId}
      guildName={guild.name}
      initialConfig={config}
      channels={textChannels}
      roles={assignableRoles}
    />
  )
}
