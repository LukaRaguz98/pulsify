import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getGuildAccess } from '@/lib/guild-access'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles } from '@/lib/discord'
import { PollResultsContent } from '@/components/dashboard/polls/PollResultsContent'
import { normalisePoll, type Poll } from '@/lib/polls'

export default async function PollResultsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')
  // Results is an analytics/management surface — members vote in Discord and use
  // the Polls page; send them there.
  if (access.effectiveRole === 'member') redirect(`/dashboard/${guildId}/polls`)

  const supabase = await createClient()
  const [guild, channels, roles, { data: rows }] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
    supabase.from('polls').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(500),
  ])

  const textChannels = channels.map((c) => ({ id: c.id, name: c.name }))
  const assignableRoles = roles
    .filter((r) => r.id !== guildId && !r.managed)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }))
  const polls: Poll[] = (rows ?? []).map((r) => normalisePoll(r as Record<string, unknown>))

  return (
    <PollResultsContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      polls={polls}
      channels={textChannels}
      roles={assignableRoles}
    />
  )
}
