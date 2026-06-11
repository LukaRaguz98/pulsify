import { redirect } from 'next/navigation'
import { Store, Coins, Gift, Sparkles } from 'lucide-react'
import { getGuildAccess } from '@/lib/guild-access'
import { fetchGuild } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * Economy › Marketplace — the future home of spending Pulse Coins (shops,
 * items, perks, member-to-member listings). Deliberately shipped as a
 * first-class route now so the Economy section's structure is stable before
 * the feature lands; today it's an empty state for everyone.
 */
export default async function MarketplacePage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  const guild = await fetchGuild(guildId)
  if (!guild) redirect('/dashboard')

  const upcoming = [
    {
      icon: <Store size={15} />,
      title: 'Server shops',
      body: 'Spend Pulse Coins on perks, roles and custom rewards offered by each community.',
    },
    {
      icon: <Gift size={15} />,
      title: 'Items & inventories',
      body: 'Collectibles and consumables that travel with your global Pulse identity.',
    },
    {
      icon: <Sparkles size={15} />,
      title: 'Member listings',
      body: 'Trade with other members — powered by the same atomic transfer rails as /pay.',
    },
  ]

  return (
    <div className="page-content">
      <PageHeader
        title="Marketplace"
        helpId="marketplace"
        description={
          <>
            Spend your Pulse Coins — coming soon to{' '}
            <span className="font-medium text-foreground">{guild.name}</span> and every Pulse server
          </>
        }
      />

      <EmptyState
        icon={<Store size={36} />}
        title="The Marketplace is on its way"
        description="This is where Pulse Coins become spendable — shops, items and member trading, built on the global economy. Keep earning: your balance carries over the day it opens."
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {upcoming.map((u) => (
          <div
            key={u.title}
            className="rounded-xl border p-5"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <span style={{ color: 'var(--p-1)' }}>{u.icon}</span>
              {u.title}
            </div>
            <p className="text-sm text-muted-foreground">{u.body}</p>
          </div>
        ))}
      </div>

      <p className="mt-6 flex items-center gap-2 text-xs text-subtle">
        <Coins size={12} />
        Your balance is already global — anything you earn now will be spendable here.
      </p>
    </div>
  )
}
