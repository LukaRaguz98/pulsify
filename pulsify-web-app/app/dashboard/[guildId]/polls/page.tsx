import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getGuildAccess } from '@/lib/guild-access'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles, CHANNEL_TYPES } from '@/lib/discord'
import { PollsContent } from '@/components/dashboard/polls/PollsContent'
import { normalisePoll, type Poll } from '@/lib/polls'

export default async function PollsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')
  const supabase = await createClient()

  // Members get a read-only view (voting happens in Discord); admins get the
  // full management surface with creation, editing and closing.
  if (access.effectiveRole === 'member') {
    const [guild, { data: rows }] = await Promise.all([
      fetchGuild(guildId),
      supabase.from('polls').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(100),
    ])
    if (!guild) redirect('/dashboard')
    const polls: Poll[] = (rows ?? []).map((r) => normalisePoll(r as Record<string, unknown>))
    return (
      <PollsContent guildId={guildId} guildName={guild.name} initialPolls={polls} channels={[]} roles={[]} readOnly />
    )
  }

  const [guild, channels, roles, { data: rows }] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
    supabase.from('polls').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(200),
  ])

  const textChannels = channels
    .filter((c) => c.type === CHANNEL_TYPES.TEXT || c.type === CHANNEL_TYPES.ANNOUNCEMENT)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }))
  const assignableRoles = roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }))

  const polls: Poll[] = (rows ?? []).map((r) => normalisePoll(r as Record<string, unknown>))

  return (
    <PollsContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      initialPolls={polls}
      channels={textChannels}
      roles={assignableRoles}
    />
  )
}
