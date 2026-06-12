import { redirect } from 'next/navigation'
import { getGuildAccess } from '@/lib/guild-access'
import { MemberProfile } from '@/components/dashboard/members/MemberProfile'

/**
 * Member-facing detail for ANOTHER member's profile (PULSIFY-45) — reached by
 * clicking a leaderboard row. Outside the (management) group so members can open
 * it. Renders the read-only member copy (the bundle API withholds the moderation
 * slice from non-admins); operators previewing member view see the same. Back
 * link returns to the leaderboard the row was clicked from.
 */
export default async function MemberProfileDetailPage({
  params,
}: {
  params: Promise<{ guildId: string; userId: string }>
}) {
  const { guildId, userId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  return (
    <MemberProfile
      guildId={guildId}
      userId={userId}
      viewerRole={access.effectiveRole}
      backHref={`/dashboard/${guildId}/leaderboard`}
      backLabel="Back to Leaderboard"
    />
  )
}
