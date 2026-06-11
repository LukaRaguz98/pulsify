import { redirect } from 'next/navigation'
import { getGuildAccess } from '@/lib/guild-access'
import { fetchGuild } from '@/lib/discord'
import { StatisticsContent } from '@/components/dashboard/StatisticsContent'

export default async function StatisticsPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  // Statistics is read-only and part of the member experience — any member of
  // the guild may view it (the analytics API enforces the same).
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  const guild = await fetchGuild(guildId)
  if (!guild) redirect('/dashboard')

  return <StatisticsContent guildId={guildId} guildName={guild.name} />
}
