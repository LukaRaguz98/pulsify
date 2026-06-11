import { redirect } from 'next/navigation'
import { getGuildAccess } from '@/lib/guild-access'

/**
 * Management gate. Everything inside this route group is server management —
 * moderation, configuration, structural tools — so it requires Manage Server /
 * Administrator. Regular members (and operators previewing Member View) are
 * bounced to the guild home, which lands them on their member experience.
 * Community-visible routes (statistics, economy, events, giveaways,
 * announcements, profile, reputation, leaderboard) live OUTSIDE this group.
 */
export default async function ManagementLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')
  if (access.effectiveRole !== 'admin') redirect(`/dashboard/${guildId}`)

  return <>{children}</>
}
