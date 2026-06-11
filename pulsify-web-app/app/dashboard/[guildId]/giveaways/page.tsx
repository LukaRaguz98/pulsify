import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getGuildAccess } from '@/lib/guild-access'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles, CHANNEL_TYPES } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { GiveawaysContent } from '@/components/dashboard/giveaways/GiveawaysContent'
import { MemberGiveaways } from '@/components/dashboard/member-view/MemberGiveaways'
import { normaliseGiveaway, type Giveaway } from '@/lib/giveaways'

export default async function GiveawaysPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')
  const supabase = await createClient()

  // Members get a read-only list (join happens in Discord); admins keep the
  // full management view with creation, draws and re-rolls.
  if (access.effectiveRole === 'member') {
    const [guild, { data: rows }] = await Promise.all([
      fetchGuild(guildId),
      supabase
        .from('giveaways')
        .select('*')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    if (!guild) redirect('/dashboard')
    const giveaways: Giveaway[] = (rows ?? []).map((r) => normaliseGiveaway(r as Record<string, unknown>))
    return (
      <div className="page-content">
        <PageHeader
          title="Giveaways"
          helpId="giveaways"
          description={
            <>
              Active and recent giveaways in{' '}
              <span className="font-medium text-foreground">{guild.name}</span> — join with the
              button on the giveaway post in Discord
            </>
          }
        />
        <MemberGiveaways giveaways={giveaways} />
      </div>
    )
  }

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
