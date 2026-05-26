import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles, CHANNEL_TYPES } from '@/lib/discord'
import { GiveawaysContent } from '@/components/dashboard/giveaways/GiveawaysContent'
import { normaliseGiveaway, type Giveaway } from '@/lib/giveaways'

export default async function GiveawaysPage({
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

  const [guild, channels, roles, { data: rows }] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
    supabase
      .from('giveaways')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const textChannels = channels
    .filter((c) => c.type === CHANNEL_TYPES.TEXT || c.type === CHANNEL_TYPES.ANNOUNCEMENT)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }))
  const assignableRoles = roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }))

  const giveaways: Giveaway[] = (rows ?? []).map((r) => normaliseGiveaway(r as Record<string, unknown>))

  return (
    <GiveawaysContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      initialGiveaways={giveaways}
      channels={textChannels}
      roles={assignableRoles}
    />
  )
}
