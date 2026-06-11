import { redirect } from 'next/navigation'
import { getGuildAccess } from '@/lib/guild-access'
import { fetchGuild } from '@/lib/discord'
import { EconomyContent } from '@/components/dashboard/economy/EconomyContent'

export default async function EconomyPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  // The economy is a global, read-only surface — any member of the server may
  // view it. Controls (the only mutating surface) lives at /economy/controls
  // behind the operator gate.
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  const guild = await fetchGuild(guildId)
  if (!guild) redirect('/dashboard')

  return <EconomyContent guildId={guildId} guildName={guild.name} />
}
