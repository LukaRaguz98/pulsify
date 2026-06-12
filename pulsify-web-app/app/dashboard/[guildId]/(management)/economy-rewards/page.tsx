import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildRoles } from '@/lib/discord'
import { RewardsManager } from '@/components/dashboard/economy/RewardsManager'

/**
 * Economy › Rewards (admin) — manage this server's shop rewards (PULSIFY-46).
 * Lives in the (management) group so it's admin-only (members get the read-only
 * Shop). The GLOBAL catalogue is operator-managed in Controls, not here.
 */
export default async function EconomyRewardsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params
  const supabase = await createClient()

  const [guild, roles, { data: milestoneRows }] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildRoles(guildId),
    supabase.from('milestones').select('id, name').eq('guild_id', guildId).order('name'),
  ])
  if (!guild) redirect('/dashboard')

  const assignableRoles = roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }))

  const achievements = (milestoneRows ?? []).map((m) => ({ id: String(m.id), name: String(m.name) }))

  return (
    <RewardsManager
      guildId={guildId}
      guildName={guild.name}
      roles={assignableRoles}
      achievements={achievements}
    />
  )
}
