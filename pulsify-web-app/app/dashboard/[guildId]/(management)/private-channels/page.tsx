import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild } from '@/lib/discord'
import { PrivateChannelsContent, type ActiveChannel } from '@/components/dashboard/private-channels/PrivateChannelsContent'
import { normalisePrivateChannelConfig } from '@/lib/private-channels'

export default async function PrivateChannelsPage({
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

  const [guild, { data: configRow }, { data: rows }] = await Promise.all([
    fetchGuild(guildId),
    supabase.from('private_channel_configs').select('*').eq('guild_id', guildId).maybeSingle(),
    supabase
      .from('private_channels')
      .select('id, channel_id, owner_id, owner_name, name, channel_type, locked, user_limit, created_at, empty_since')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  const config = normalisePrivateChannelConfig(configRow)
  const activeChannels = (rows ?? []) as ActiveChannel[]

  return (
    <PrivateChannelsContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      enabled={config.enabled}
      settingsHref={`/dashboard/${guildId}/private-channels-settings`}
      initialChannels={activeChannels}
    />
  )
}
