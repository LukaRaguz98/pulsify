import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getGuildAccess } from '@/lib/guild-access'
import { fetchGuild, fetchGuildRoles } from '@/lib/discord'
import { ShopContent } from '@/components/dashboard/economy/ShopContent'

/**
 * Economy › Shop — the rewards shop (PULSIFY-46). Outside the (management)
 * group: spending the GLOBAL balance is part of the member experience, so any
 * member of the guild may browse and buy. Admins ALSO manage this server's
 * rewards inline here (PULSIFY-47 consolidation) — create/edit/delete in the
 * "{Server} shop" section; members never see those controls.
 */
export default async function ShopPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  const isAdmin = access.effectiveRole === 'admin'

  // Roles + achievements only matter for the admin reward editor; skip the
  // extra fetches for members.
  const [guild, roles, milestonesRes] = await Promise.all([
    fetchGuild(guildId),
    isAdmin ? fetchGuildRoles(guildId) : Promise.resolve([]),
    isAdmin
      ? (await createClient()).from('milestones').select('id, name').eq('guild_id', guildId).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  if (!guild) redirect('/dashboard')

  const assignableRoles = roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }))
  const achievements = (milestonesRes.data ?? []).map((m) => ({ id: String(m.id), name: String(m.name) }))

  return (
    <ShopContent
      guildId={guildId}
      guildName={guild.name}
      isAdmin={isAdmin}
      roles={assignableRoles}
      achievements={achievements}
    />
  )
}
