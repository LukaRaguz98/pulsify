import { redirect } from 'next/navigation'
import { getGuildAccess } from '@/lib/guild-access'
import { fetchGuild } from '@/lib/discord'
import { ShopContent } from '@/components/dashboard/economy/ShopContent'

/**
 * Economy › Shop — the member-facing rewards shop (PULSIFY-46). Outside the
 * (management) group: spending the GLOBAL balance is part of the member
 * experience, so any member of the guild may browse and buy.
 */
export default async function ShopPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  const guild = await fetchGuild(guildId)
  if (!guild) redirect('/dashboard')

  return <ShopContent guildId={guildId} guildName={guild.name} />
}
