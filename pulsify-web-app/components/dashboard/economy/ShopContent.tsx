'use client'

import { useMemo, useState } from 'react'
import { Store, Globe, Coins, Search, AlertCircle, CheckCircle2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { CategorySection } from '@/components/ui/category-section'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  CATEGORY_META,
  REWARD_CATEGORIES,
  formatCoins,
  type ShopReward,
  type RewardCategory,
} from '@/lib/shop'
import { useShop } from '@/lib/use-shop'
import { refreshOwnedCosmetics } from '@/lib/use-cosmetics'
import { RewardCard } from './RewardCard'

type Props = { guildId: string; guildName: string }

export function ShopContent({ guildId, guildName }: Props) {
  const { data, loading, refreshing, error, refresh } = useShop(guildId)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<RewardCategory | 'all'>('all')
  const [affordableOnly, setAffordableOnly] = useState(false)
  const [buying, setBuying] = useState<ShopReward | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  // Optimistic balance so the wallet updates the moment a purchase lands.
  const [balanceOverride, setBalanceOverride] = useState<number | null>(null)

  const balance = balanceOverride ?? data?.context.balance ?? 0

  const filtered = useMemo(() => {
    const rewards = data?.rewards ?? []
    const q = query.trim().toLowerCase()
    return rewards.filter((r) => {
      if (category !== 'all' && r.category !== category) return false
      if (affordableOnly && r.cost > balance) return false
      if (q && !r.name.toLowerCase().includes(q) && !(r.description ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [data, query, category, affordableOnly, balance])

  // Split by scope so the shop clearly separates the Pulse-wide global catalogue
  // from this server's own rewards (each already sorted featured-first by the API).
  const globalRewards = filtered.filter((r) => r.scope === 'global')
  const serverRewards = filtered.filter((r) => r.scope === 'server')

  // Categories actually present, in the canonical order.
  const presentCategories = REWARD_CATEGORIES.filter((c) => (data?.rewards ?? []).some((r) => r.category === c))

  async function confirmBuy() {
    if (!buying) return
    setBusy(true)
    setDialogError(null)
    try {
      const res = await fetch(`/api/guilds/${guildId}/economy/shop/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId: buying.id }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; balance?: number }
      if (!res.ok) throw new Error(body.error ?? 'Purchase failed.')
      if (typeof body.balance === 'number') setBalanceOverride(body.balance)
      setFlash({ kind: 'ok', text: `Bought “${buying.name}”.` })
      setBuying(null)
      // A cosmetic purchase may unlock a Preferences toggle (e.g. the Corner HUD)
      // — drop the cached ownership so it reflects without a reload.
      if (buying.category === 'cosmetic') refreshOwnedCosmetics()
      refresh()
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'Purchase failed.')
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <PageHeader
      title="Shop"
      helpId="shop"
      description={
        <>
          Spend your Pulse Coins on rewards from{' '}
          <span className="font-medium text-foreground">{guildName}</span> and the global catalogue
        </>
      }
      action={
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--p-1)' }}
            title="Your global Pulse Coin balance"
          >
            <Coins size={15} />
            {formatCoins(balance)}
          </span>
          <RefreshButton onClick={refresh} refreshing={refreshing} />
        </div>
      }
    />
  )

  if (loading) {
    return (
      <div className="page-content">
        {header}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[210px]" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="page-content">
        {header}
        <div className="flex items-center gap-3 rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'rgba(239,68,68,0.35)' }}>
          <AlertCircle size={18} style={{ color: '#f87171' }} />
          <p className="text-sm text-muted-foreground">{error ?? 'The shop is unavailable right now.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      {header}

      {flash && (
        <div
          className="mb-5 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
          style={
            flash.kind === 'ok'
              ? { background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' }
              : { background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)', color: '#f87171' }
          }
        >
          {flash.kind === 'ok' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {flash.text}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-xs flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search rewards…"
            className="w-full rounded-lg border bg-transparent py-2 pl-9 pr-3 text-sm outline-none"
            style={{ borderColor: 'var(--line-strong)' }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCategory('all')}
            className="rounded-lg px-2.5 py-1 text-xs font-medium transition"
            style={category === 'all' ? { background: 'var(--p-soft)', color: 'var(--p-1)' } : { color: 'var(--text-3)' }}
          >
            All
          </button>
          {presentCategories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className="rounded-lg px-2.5 py-1 text-xs font-medium transition"
              style={category === c ? { background: 'var(--p-soft)', color: 'var(--p-1)' } : { color: 'var(--text-3)' }}
            >
              {CATEGORY_META[c].label}
            </button>
          ))}
          <label className="ml-1 inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            Affordable
            <button
              type="button"
              role="switch"
              aria-checked={affordableOnly}
              aria-label="Show only affordable rewards"
              onClick={() => setAffordableOnly((v) => !v)}
              className="relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200"
              style={{ background: affordableOnly ? 'var(--p-1)' : 'var(--line-strong)' }}
            >
              <span
                className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
                style={{ transform: affordableOnly ? 'translateX(16px)' : 'translateX(0)' }}
              />
            </button>
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Store size={36} />}
          title="No rewards here yet"
          description="When this server's admins add rewards — or you tweak your filters — they'll show up here to spend your Pulse Coins on."
        />
      ) : (
        <div className="space-y-8">
          {/* Global catalogue — Pulse-wide, the same in every server. */}
          {globalRewards.length > 0 && (
            <CategorySection
              icon={<Globe size={14} />}
              title="Global catalogue"
              description="Pulse-wide rewards — available in every server running Pulse."
            >
              <Grid rewards={globalRewards} {...{ data, setBuying, busyId: busy ? buying?.id : null }} />
            </CategorySection>
          )}

          {/* This server's own rewards, created by its admins. */}
          {serverRewards.length > 0 && (
            <CategorySection
              icon={<Store size={14} />}
              title={`${guildName} shop`}
              description="Rewards this server’s admins created for their community."
            >
              <Grid rewards={serverRewards} {...{ data, setBuying, busyId: busy ? buying?.id : null }} />
            </CategorySection>
          )}
        </div>
      )}

      {buying && (
        <ConfirmDialog
          title={`Buy “${buying.name}”?`}
          description={`This costs ${formatCoins(buying.cost)} Pulse Coins. Your balance after: ${formatCoins(Math.max(0, balance - buying.cost))}.`}
          confirmLabel="Buy"
          busy={busy}
          error={dialogError}
          onCancel={() => { if (!busy) { setBuying(null); setDialogError(null) } }}
          onConfirm={confirmBuy}
        />
      )}
    </div>
  )
}

function Grid({
  rewards,
  data,
  setBuying,
  busyId,
}: {
  rewards: ShopReward[]
  data: NonNullable<ReturnType<typeof useShop>['data']>
  setBuying: (r: ShopReward) => void
  busyId: string | null | undefined
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rewards.map((r) => (
        <RewardCard
          key={r.id}
          reward={r}
          ownedCount={data.ownedCounts[r.id] ?? 0}
          context={data.context}
          busy={busyId === r.id}
          onBuy={setBuying}
        />
      ))}
    </div>
  )
}
