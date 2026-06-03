import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, CHANNEL_TYPES } from '@/lib/discord'
import { IntegrationsContent } from '@/components/dashboard/integrations/IntegrationsContent'
import {
  normaliseIntegration,
  normaliseLog,
  type Integration,
  type IntegrationLog,
} from '@/lib/integrations'

export default async function IntegrationsPage({
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

  const [guild, channels, { data: rows }, { data: logRows }] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    supabase
      .from('integrations')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('integration_logs')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(300),
  ])

  const textChannels = channels
    .filter((c) => c.type === CHANNEL_TYPES.TEXT || c.type === CHANNEL_TYPES.ANNOUNCEMENT)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }))

  const integrations: Integration[] = (rows ?? []).map((r) =>
    normaliseIntegration(r as Record<string, unknown>),
  )
  const logs: IntegrationLog[] = (logRows ?? []).map((r) =>
    normaliseLog(r as Record<string, unknown>),
  )

  return (
    <IntegrationsContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      initialIntegrations={integrations}
      initialLogs={logs}
      channels={textChannels}
    />
  )
}
