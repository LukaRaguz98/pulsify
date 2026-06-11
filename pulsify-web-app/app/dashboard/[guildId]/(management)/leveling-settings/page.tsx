import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles, CHANNEL_TYPES } from '@/lib/discord'
import { normaliseLevelingSettings } from '@/lib/leveling'
import { LevelingSettingsContent } from '@/components/dashboard/leveling/LevelingSettingsContent'

export default async function LevelingSettingsPage({
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
    supabase.from('leveling_settings').select('enabled, settings').eq('guild_id', guildId).maybeSingle(),
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

  const config = normaliseLevelingSettings(row ?? null)

  return (
    <LevelingSettingsContent
      guildId={guildId}
      guildName={guild.name}
      initialConfig={config}
      channels={textChannels}
      roles={assignableRoles}
    />
  )
}
