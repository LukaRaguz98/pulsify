import { redirect } from 'next/navigation'
import { Globe, Info, Star } from 'lucide-react'
import { getGuildAccess } from '@/lib/guild-access'
import { getGlobalReputationBundle } from '@/lib/economy-server'
import { formatDuration } from '@/lib/analytics'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { ReputationPanel } from '@/components/dashboard/members/ReputationPanel'
import { LeaderboardLink } from '@/components/dashboard/LeaderboardLink'

/**
 * Member-facing Reputation page: the viewer's own GLOBAL 0–100 trust score
 * with the full "how this was calculated" breakdown. Reputation is computed
 * on the fly from activity aggregated across every Pulse server — it is never
 * stored and never granted (PULSIFY-45).
 */
export default async function MemberReputationPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  const { reputation, risk, inputs } = await getGlobalReputationBundle(access.userId)

  const facts = [
    { label: 'Messages', value: inputs.messages.toLocaleString() },
    { label: 'Voice time', value: inputs.voiceSeconds > 0 ? formatDuration(inputs.voiceSeconds) : '—' },
    { label: 'Commands used', value: inputs.commands.toLocaleString() },
    { label: 'Active channels', value: inputs.activeChannels.toLocaleString() },
  ]

  return (
    <div className="page-content">
      <PageHeader
        title="Reputation"
        helpId="reputation"
        description="Your global trust score — earned across every server running Pulse"
        action={<LeaderboardLink guildId={guildId} board="reputation" label="Reputation leaderboard" />}
      />

      <div className="space-y-8">
        <CategorySection
          icon={<Star size={14} />}
          title="Your score"
          description="0–100, computed from account age, tenure, participation and moderation history."
        >
          <div
            className="rounded-xl border p-5"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            <ReputationPanel reputation={reputation} risk={risk} />
          </div>
        </CategorySection>

        <CategorySection
          icon={<Globe size={14} />}
          title="What feeds it"
          description="Your activity totals across the whole Pulse network — not just this server."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {facts.map((f) => (
              <div
                key={f.label}
                className="rounded-xl border p-4"
                style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
              >
                <p className="text-xs text-subtle">{f.label}</p>
                <p className="mt-1.5 font-mono text-xl font-bold text-foreground">{f.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 flex items-start gap-2 text-xs text-subtle">
            <Info size={13} className="mt-0.5 shrink-0" />
            Reputation is global and computed live — it can&apos;t be bought, granted or transferred.
            Being active and staying in good standing raises it; warnings, timeouts, kicks and bans
            lower it. Levels &amp; XP are separate and stay specific to each server.
          </p>
        </CategorySection>
      </div>
    </div>
  )
}
