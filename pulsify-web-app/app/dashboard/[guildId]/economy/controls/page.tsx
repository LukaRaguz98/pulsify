import { redirect } from 'next/navigation'
import { Crown, Lock } from 'lucide-react'
import { getGuildAccess } from '@/lib/guild-access'
import { isCurrentUserOperator, getOperators } from '@/lib/operator'
import { fetchGuild } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { EconomyControls } from '@/components/dashboard/economy/EconomyControls'

/**
 * Economy › Controls — operator-only (lock-marked in the nav, like Presence).
 * Grant/remove global coins with a full audit trail. The economy is bot-wide,
 * so this is reserved for the people who run the Pulsify deployment, never
 * per-server admins; the POST endpoint re-checks operator status too.
 */
export default async function EconomyControlsPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  const isOperator = await isCurrentUserOperator()
  if (!isOperator || access.effectiveRole !== 'admin') redirect(`/dashboard/${guildId}/economy`)

  const [guild, operators] = await Promise.all([fetchGuild(guildId), getOperators()])
  if (!guild) redirect('/dashboard')

  return (
    <div className="page-content">
      <PageHeader
        title="Economy Controls"
        helpId="economy-controls"
        description={
          <>
            <Lock size={13} className="mr-1 inline" style={{ color: 'var(--p-1)' }} aria-label="Operator-only" />
            <Crown size={13} className="mr-1 inline" style={{ color: 'var(--p-1)' }} />
            Operator-only administration of the global Pulse economy, acting from{' '}
            <span className="font-medium text-foreground">{guild.name}</span>
          </>
        }
      />
      <EconomyControls guildId={guildId} operators={operators} />
    </div>
  )
}
