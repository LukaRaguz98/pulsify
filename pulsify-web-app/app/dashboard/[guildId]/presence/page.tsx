import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild } from '@/lib/discord'
import { isCurrentUserOperator, getOperators } from '@/lib/operator'
import { PresenceContent } from '@/components/dashboard/presence/PresenceContent'
import {
  normalisePresenceConfig,
  configToDraft,
  type PresenceVars,
} from '@/lib/presence'

export default async function PresencePage({
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

  const [guild, { data: configRow }, { data: stateRow }, operator, operators, ticketsCount, giveawaysCount, serversCount] =
    await Promise.all([
      fetchGuild(guildId),
      supabase.from('guild_presence').select('*').eq('guild_id', guildId).maybeSingle(),
      supabase.from('bot_presence_state').select('active_guild_id').eq('id', 1).maybeSingle(),
      isCurrentUserOperator(),
      getOperators(),
      supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('guild_id', guildId)
        .neq('status', 'closed'),
      supabase
        .from('giveaways')
        .select('id', { count: 'exact', head: true })
        .eq('guild_id', guildId)
        .eq('status', 'active'),
      supabase.from('synced_guilds').select('guild_id', { count: 'exact', head: true }),
    ])

  const config = normalisePresenceConfig(configRow as Record<string, unknown> | null, guildId)
  const activeGuildId = (stateRow?.active_guild_id as string | null) ?? null
  // Pulse has a single bot-wide presence, so only the configured operator(s)
  // may edit it. Everyone else gets a read-only view + preview.
  const canEdit = operator

  // Representative live values for the preview card. {servers} is bot-wide;
  // the rest reflect THIS server (which is what its config drives when active).
  const previewVars: PresenceVars = {
    servers: serversCount.count ?? 0,
    members: guild?.approximate_member_count ?? guild?.member_count ?? 0,
    tickets: ticketsCount.count ?? 0,
    giveaways: giveawaysCount.count ?? 0,
    mod_actions: 0,
    uptime: '3d 4h',
  }

  return (
    <PresenceContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      initialDraft={configToDraft(config)}
      lastUpdated={config.updatedAt}
      activeGuildId={activeGuildId}
      canEdit={canEdit}
      operators={operators}
      previewVars={previewVars}
    />
  )
}
