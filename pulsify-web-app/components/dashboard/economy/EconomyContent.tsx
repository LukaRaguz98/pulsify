'use client'

import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  LineChart,
  ReceiptText,
  Repeat,
  Trophy,
  Users,
  Wallet,
  SlidersHorizontal,
  Lock,
} from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { CategorySection } from '@/components/ui/category-section'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { ChartCard } from '@/components/dashboard/charts/ChartCard'
import { TrendChart } from '@/components/dashboard/charts/TrendChart'
import { RankedList } from '@/components/dashboard/RankedList'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { LeaderboardLink } from '@/components/dashboard/LeaderboardLink'
import { TimeframeFilter } from '@/components/dashboard/TimeframeFilter'
import { formatBucketLabel, timeframePeriodLabel, type Timeframe } from '@/lib/analytics'
import { useEconomy } from '@/lib/use-economy'
import { formatCoins } from '@/lib/economy'
import { EconomyTransactions } from './EconomyTransactions'

type Props = {
  guildId: string
  guildName: string
  /** Earning feeds the GLOBAL coin economy, so its config is operator-only —
   * only the operator sees the (locked) "Earnings settings" entry point. */
  isOperator?: boolean
}

/**
 * Economy › Overview. The Economy section is nav-driven (PULSIFY-45 follow-up):
 * Overview (this — analytics, leaderboards and the full transaction ledger),
 * the Shop + Inventory (PULSIFY-46) and the operator-only Controls
 * (/economy/controls) are separate routes under the "Economy" nav category.
 * Everything here is a read of the GLOBAL economy, so members see it too.
 */
export function EconomyContent({ guildId, guildName, isOperator = false }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('30d')
  const { data, loading, refreshing, error, refresh } = useEconomy(guildId, timeframe)

  const header = (
    <PageHeader
      title="Earnings"
      helpId="economy"
      description={
        <>
          The global Pulse coin economy — balances shared across every server, viewed from{' '}
          <span className="font-medium text-foreground">{guildName}</span>
        </>
      }
      action={
        <div className="flex items-center gap-3">
          {/* Operator-only: earning rules feed the GLOBAL economy, so only the
              Pulsify operator can edit them (same gate as Controls). */}
          {isOperator && (
            <Link
              href={`/dashboard/${guildId}/economy-earning`}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              title="Operator-only — earning feeds the global economy"
            >
              <Lock size={12} style={{ color: 'var(--p-1)' }} />
              <SlidersHorizontal size={14} /> Earnings settings
            </Link>
          )}
          <LeaderboardLink guildId={guildId} board="richest" label="Richest leaderboard" size="md" />
          <TimeframeFilter value={timeframe} onChange={setTimeframe} disabled={loading} />
          <RefreshButton onClick={refresh} refreshing={refreshing} />
        </div>
      }
    />
  )

  if (loading) {
    return (
      <div className="page-content">
        {header}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[124px]" />
          ))}
        </div>
        <Skeleton className="mb-8 h-[320px]" />
        <Skeleton className="h-[260px]" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="page-content">
        {header}
        <div
          className="flex items-center gap-3 rounded-xl border p-5"
          style={{ background: 'var(--panel)', borderColor: 'rgba(239,68,68,0.35)' }}
        >
          <AlertCircle size={18} style={{ color: '#f87171' }} />
          <p className="text-sm text-muted-foreground">
            {error ?? 'The economy is unavailable right now.'}
          </p>
        </div>
      </div>
    )
  }

  const { totals, analytics } = data
  const period = timeframePeriodLabel(timeframe)

  return (
    <div className="page-content">
      {header}

      <div className="space-y-8">
        <CategorySection
          icon={<Coins size={14} />}
          title="Circulation & flow"
          description={`Coins held across the network and how they moved over ${period}.`}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              label="In circulation"
              value={formatCoins(totals.circulation)}
              sub={`${totals.userCount.toLocaleString()} wallet${totals.userCount === 1 ? '' : 's'} across all servers`}
              icon={<Coins size={15} />}
            />
            <StatsCard
              label="Coins earned"
              value={formatCoins(analytics.earned)}
              sub={`All servers · ${period}`}
              icon={<ArrowUpRight size={15} />}
              accent="var(--green)"
            />
            <StatsCard
              label="Coins spent"
              value={formatCoins(analytics.spent)}
              sub={`All servers · ${period}`}
              icon={<ArrowDownRight size={15} />}
              accent="var(--amber)"
            />
            <StatsCard
              label="Transfers"
              value={formatCoins(analytics.transferVolume)}
              sub={`Moved between members · ${period}`}
              icon={<Repeat size={15} />}
              accent="var(--cyan)"
            />
          </div>
        </CategorySection>

        <CategorySection
          icon={<LineChart size={14} />}
          title="Trends"
          description={`Coins earned and spent over ${period}.`}
        >
          <ChartCard
            title="Economy trends"
            subtitle={`Coins earned & spent · ${period}`}
            icon={<LineChart size={14} />}
          >
            <TrendChart
              data={analytics.trend}
              xKey="bucket"
              series={[
                { key: 'earned', name: 'Coins earned', color: 'var(--green)' },
                { key: 'spent', name: 'Coins spent', color: 'var(--amber)' },
              ]}
              height={280}
              showLegend
              xTickFormatter={(v) => formatBucketLabel(v, timeframe)}
            />
          </ChartCard>
        </CategorySection>

        <CategorySection
          icon={<Trophy size={14} />}
          title="Top earners"
          description={`Members who earned the most coins over ${period}.`}
        >
          <ChartCard
            title="Top earners"
            subtitle={`Most coins earned · ${period}`}
            icon={<Wallet size={14} />}
            disableLandscape
          >
            <RankedList
              items={analytics.topEarners.map((e) => ({
                id: e.user_id,
                label: e.user_name ?? e.user_id,
                value: e.amount,
              }))}
              valueFormatter={(v) => `${formatCoins(v)} coins`}
              barColor="var(--green)"
              emptyText="No coins earned in this window yet."
            />
            {/* Earned-in-this-window is not the same ranking as balance held —
                the standing wealth board lives with every other leaderboard. */}
            <LeaderboardLink
              guildId={guildId}
              board="richest"
              variant="inline"
              label="Ranked by balance in Leaderboards"
              className="mt-4"
            />
          </ChartCard>
        </CategorySection>

        <CategorySection
          icon={<ReceiptText size={14} />}
          title="Transactions"
          description="The coin ledger — every balance change with its source, kind and context."
        >
          <EconomyTransactions guildId={guildId} />
        </CategorySection>

        <p className="flex items-center gap-2 text-xs text-subtle">
          <Users size={12} />
          Balance is global across every Pulse server. Levels &amp; XP stay specific to each
          server — see Members › Leaderboards for member rankings, including the richest wallets.
        </p>
      </div>
    </div>
  )
}
