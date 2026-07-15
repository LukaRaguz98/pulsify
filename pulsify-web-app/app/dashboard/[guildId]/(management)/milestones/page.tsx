import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles, CHANNEL_TYPES } from '@/lib/discord'
import { MilestonesContent } from '@/components/dashboard/milestones/MilestonesContent'
import { normaliseMilestone, type Milestone, type MilestoneCompletion } from '@/lib/milestones'

/** Per-member metric snapshot for the "Members" (eligible) tab. */
export type MemberMetricRow = {
  user_id: string
  user_name: string | null
  messages: number
  voice_minutes: number
  events: number
  giveaways: number
  invites: number
  xp: number
  level: number
}

export default async function MilestonesPage({
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

  const [guild, channels, roles, { data: rows }, { data: completionRows }, { data: metricRows }, inviteSettings] =
    await Promise.all([
      fetchGuild(guildId),
      fetchGuildChannels(guildId),
      fetchGuildRoles(guildId),
      supabase
        .from('milestones')
        .select('*')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('member_milestones')
        .select('milestone_id, user_id, user_name, value, completed_at')
        .eq('guild_id', guildId)
        .order('completed_at', { ascending: false })
        .limit(500),
      supabase.rpc('get_member_milestone_metrics', { p_guild_id: guildId }),
      supabase.from('invite_settings').select('enabled').eq('guild_id', guildId).maybeSingle(),
    ])

  // Invite milestones only make sense when invite tracking is on, so the editor
  // hides the metric otherwise.
  const inviteTrackingEnabled = inviteSettings.data?.enabled === true

  const textChannels = channels
    .filter((c) => c.type === CHANNEL_TYPES.TEXT || c.type === CHANNEL_TYPES.ANNOUNCEMENT)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }))
  const assignableRoles = roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }))

  const milestones: Milestone[] = (rows ?? []).map((r) => normaliseMilestone(r as Record<string, unknown>))
  const completions: MilestoneCompletion[] = (completionRows ?? []).map((c) => ({
    milestone_id: String(c.milestone_id),
    user_id: String(c.user_id),
    user_name: c.user_name ?? null,
    value: Number(c.value ?? 0),
    completed_at: String(c.completed_at),
  }))
  const metrics: MemberMetricRow[] = (metricRows ?? []).map((m: Record<string, unknown>) => ({
    user_id: String(m.user_id),
    user_name: (m.user_name as string | null) ?? null,
    messages: Number(m.messages ?? 0),
    voice_minutes: Math.floor(Number(m.voice_seconds ?? 0) / 60),
    events: Number(m.events ?? 0),
    giveaways: Number(m.giveaways ?? 0),
    invites: Number(m.invites ?? 0),
    xp: Number(m.xp ?? 0),
    level: Number(m.level ?? 0),
  }))

  return (
    <MilestonesContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      initialMilestones={milestones}
      completions={completions}
      metrics={metrics}
      channels={textChannels}
      roles={assignableRoles}
      inviteTrackingEnabled={inviteTrackingEnabled}
    />
  )
}
