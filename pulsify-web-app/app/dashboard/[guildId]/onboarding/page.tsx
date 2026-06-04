import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import {
  fetchGuild,
  fetchGuildChannels,
  fetchGuildRoles,
  fetchGuildEvents,
  checkBotPermissions,
  guildIconUrl,
  type DiscordScheduledEvent,
} from '@/lib/discord'
import { OnboardingManager } from '@/components/dashboard/onboarding/OnboardingManager'
import {
  normalizeMemberOnboarding,
  type MemberOnboardingConfig,
  type OnboardingStats,
} from '@/lib/onboarding'

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

  const [guild, channels, roles, perms, settingsRow, statsRes] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
    checkBotPermissions(guildId),
    supabase.from('guild_settings').select('settings').eq('guild_id', guildId).maybeSingle(),
    supabase.rpc('get_onboarding_stats', { p_guild_id: guildId, p_days: 30 }),
  ])
  if (!guild) redirect('/dashboard')

  // Scheduled-events fetch can throw on transient 429s — never block the editor.
  let events: DiscordScheduledEvent[] = []
  try {
    events = await fetchGuildEvents(guildId)
  } catch {
    events = []
  }

  const settings = (settingsRow.data?.settings as Record<string, unknown>) ?? {}
  const config: MemberOnboardingConfig = normalizeMemberOnboarding(
    settings.member_onboarding as Partial<MemberOnboardingConfig> | undefined,
  )

  const textChannels = channels
    .filter((c) => c.type === 0 || c.type === 5)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name, type: c.type }))

  const assignableRoles = roles
    .filter((r) => r.name !== '@everyone' && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }))

  const upcomingEvents = events
    .filter((e) => e.status === 1 || e.status === 2)
    .sort((a, b) => +new Date(a.scheduled_start_time) - +new Date(b.scheduled_start_time))
    .map((e) => ({
      id: e.id,
      name: e.name,
      scheduled_start_time: e.scheduled_start_time,
      user_count: e.user_count ?? 0,
    }))

  const stats = (statsRes.data as OnboardingStats | null) ?? null

  return (
    <OnboardingManager
      guildId={guildId}
      guildName={guild.name}
      guildIcon={guildIconUrl(guild.id, guild.icon, 64) || null}
      channels={textChannels}
      roles={assignableRoles}
      events={upcomingEvents}
      perms={perms}
      initialConfig={config}
      stats={stats}
    />
  )
}
