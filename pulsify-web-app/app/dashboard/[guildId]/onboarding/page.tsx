import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import {
  fetchGuild,
  fetchGuildChannels,
  fetchGuildRoles,
  checkBotPermissions,
  guildIconUrl,
} from '@/lib/discord'
import { OnboardingWizard } from '@/components/dashboard/onboarding/OnboardingWizard'
import type { OnboardingState } from '@/lib/onboarding'

export default async function OnboardingPage({
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

  const [guild, channels, roles, perms, settingsRow] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
    checkBotPermissions(guildId),
    supabase.from('guild_settings').select('settings').eq('guild_id', guildId).maybeSingle(),
  ])
  if (!guild) redirect('/dashboard')

  const settings = (settingsRow.data?.settings as Record<string, unknown>) ?? {}
  const state = (settings.onboarding_state as OnboardingState | undefined) ?? null
  const welcome = settings.welcome as { channel_id?: string } | undefined
  const moderation = settings.moderation_alerts as { channel_id?: string } | undefined
  const autoRole = settings.auto_role as { role_id?: string } | undefined

  // Text + announcement channels are the only ones that can receive posts.
  const textChannels = channels
    .filter((c) => c.type === 0 || c.type === 5)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name, type: c.type }))

  const assignableRoles = roles
    .filter((r) => r.name !== '@everyone' && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }))

  const firstChannel = textChannels[0]?.id ?? ''
  const defaults = {
    welcomeChannelId: welcome?.channel_id ?? firstChannel,
    modChannelId: moderation?.channel_id ?? firstChannel,
    autoRoleId: autoRole?.role_id ?? '',
  }

  return (
    <OnboardingWizard
      guildId={guildId}
      guildName={guild.name}
      guildIcon={guildIconUrl(guild.id, guild.icon, 64) || null}
      channels={textChannels}
      roles={assignableRoles}
      perms={perms}
      defaults={defaults}
      initialState={state}
    />
  )
}
