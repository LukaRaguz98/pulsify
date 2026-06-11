import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles } from '@/lib/discord'
import { ScheduledContent } from '@/components/dashboard/ScheduledContent'
import type { Automation } from '@/lib/automations'

export default async function ScheduledPage({
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
      .from('scheduled_automations')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false }),
  ])

  // Text + announcement channels are the meaningful targets for posting and
  // channel moderation; voice/category channels can't carry messages.
  const textChannels = channels
    .filter((c) => c.type === 0 || c.type === 5)
    .sort((a, b) => a.position - b.position)

  // Drop @everyone and managed/bot roles — they aren't useful sync/cleanup
  // targets.
  const assignableRoles = roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)

  return (
    <ScheduledContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      channels={textChannels}
      roles={assignableRoles}
      initialAutomations={(rows ?? []) as Automation[]}
    />
  )
}
