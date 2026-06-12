import { redirect } from 'next/navigation'
import { getGuildAccess } from '@/lib/guild-access'
import { InventoryContent } from '@/components/dashboard/economy/InventoryContent'

/**
 * Economy › Inventory — the member's GLOBAL reward inventory (PULSIFY-46).
 * Member-accessible (outside the (management) group): owned, active, expired and
 * past purchases across every Pulse server, with activate/redeem actions.
 */
export default async function InventoryPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  return <InventoryContent guildId={guildId} />
}
