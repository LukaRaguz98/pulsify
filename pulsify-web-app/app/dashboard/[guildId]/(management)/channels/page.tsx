import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild } from '@/lib/discord'
import { ChannelsContent } from '@/components/dashboard/ChannelsContent'
import type { ActiveChannel } from '@/components/dashboard/private-channels/PrivateChannelsContent'
import { normalisePrivateChannelConfig } from '@/lib/private-channels'

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  // Private Channels is now a tab inside Channels, so load its config + live
  // channels here and hand them to the (client) content.
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

  return (
    <ChannelsContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      privateEnabled={config.enabled}
      privateChannels={(rows ?? []) as ActiveChannel[]}
      privateSettingsHref={`/dashboard/${guildId}/private-channels-settings`}
    />
  )
}
