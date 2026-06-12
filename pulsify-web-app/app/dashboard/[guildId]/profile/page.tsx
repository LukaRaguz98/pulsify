import { redirect } from 'next/navigation'
import { getGuildAccess } from '@/lib/guild-access'
import { MemberProfile } from '@/components/dashboard/members/MemberProfile'

/**
 * The member-facing Profile — the home of the member experience (PULSIFY-45).
 * Renders the SAME rich profile admins see (banner, stats, progression, Pulse
 * Profile, milestones, reputation, activity) in read-only member mode: no
 * moderation history/notes, quick-actions, risk or infractions. `backHref={null}`
 * hides the back link since this is reached from the nav, not a list.
 */
export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  return <MemberProfile guildId={guildId} userId={access.userId} viewerRole="member" backHref={null} />
}
