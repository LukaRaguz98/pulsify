'use client'

import { useMemo, useState } from 'react'
import { Backpack, Coins, AlertCircle, Loader2, Clock, Check } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { CategorySection } from '@/components/ui/category-section'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import {
  CATEGORY_META,
  coerceCategory,
  formatCoins,
  type RewardCategory,
  type RewardPurchase,
} from '@/lib/shop'
import { useInventory } from '@/lib/use-shop'
import { refreshOwnedCosmetics } from '@/lib/use-cosmetics'
import { CategoryIcon } from './category-icons'

type Props = { guildId: string }

function snapshotCategory(p: RewardPurchase): RewardCategory {
  return coerceCategory(p.reward_snapshot.category)
}

function isExpired(p: RewardPurchase): boolean {
  return !!p.expires_at && new Date(p.expires_at).getTime() < Date.now()
}

/** What the member can do with an owned item, if anything. */
function action(p: RewardPurchase): 'activate' | 'redeem' | null {
  if (p.status !== 'active' || isExpired(p)) return null
  const cat = snapshotCategory(p)
  if (cat === 'xp_booster') return p.activated_at ? null : 'activate'
  if (cat === 'perk') return 'redeem'
  return null
}

function statusLabel(p: RewardPurchase): { text: string; color: string } {
  if (p.status === 'refunded') return { text: 'Refunded', color: 'var(--text-3)' }
  if (p.status === 'consumed') return { text: 'Redeemed', color: 'var(--text-3)' }
  if (p.status === 'expired' || isExpired(p)) return { text: 'Expired', color: 'var(--text-3)' }
  if (p.expires_at) {
    const days = Math.ceil((new Date(p.expires_at).getTime() - Date.now()) / 86_400_000)
    return { text: days <= 1 ? 'Expires soon' : `${days}d left`, color: 'var(--amber)' }
  }
  return { text: 'Active', color: '#34d399' }
}

export function InventoryContent({ guildId }: Props) {
  const { purchases, loading, error, refresh } = useInventory(guildId)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const { active, history } = useMemo(() => {
    const list = purchases ?? []
    return {
      active: list.filter((p) => p.status === 'active' && !isExpired(p)),
      history: list.filter((p) => p.status !== 'active' || isExpired(p)),
    }
  }, [purchases])

  async function act(p: RewardPurchase, kind: 'activate' | 'redeem') {
    setBusyId(p.id)
    setFlash(null)
    try {
      const res = await fetch(`/api/guilds/${guildId}/economy/inventory/${p.id}`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Action failed.')
      setFlash(kind === 'activate' ? 'Booster activated.' : 'Reward redeemed — staff have been notified.')
      refresh()
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setBusyId(null)
    }
  }

  // Toggle a cosmetic's display on/off (badges + the Corner HUD decoration).
  async function toggleCosmetic(p: RewardPurchase, enabled: boolean) {
    setBusyId(p.id)
    setFlash(null)
    try {
      const res = await fetch(`/api/guilds/${guildId}/economy/inventory/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not update.')
      // Drop the cached cosmetic ownership so the Corner HUD reflects the toggle.
      refreshOwnedCosmetics()
      refresh()
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'Could not update.')
    } finally {
      setBusyId(null)
    }
  }

  const header = (
    <PageHeader
      title="Inventory"
      helpId="inventory"
      description="Rewards you've bought with Pulse Coins — across every Pulse server"
      action={<RefreshButton onClick={refresh} refreshing={loading} />}
    />
  )

  if (loading) {
    return (
      <div className="page-content">
        {header}
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[64px]" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-content">
        {header}
        <div className="flex items-center gap-3 rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'rgba(239,68,68,0.35)' }}>
          <AlertCircle size={18} style={{ color: '#f87171' }} />
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      {header}

      {flash && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm" style={{ background: 'var(--p-soft)', borderColor: 'var(--p-1)', color: 'var(--p-1)' }}>
          <Check size={15} /> {flash}
        </div>
      )}

      {(purchases ?? []).length === 0 ? (
        <EmptyState
          icon={<Backpack size={36} />}
          title="Nothing here yet"
          description="Rewards you buy in the Shop land here. Earn Pulse Coins by being active, then treat yourself."
        />
      ) : (
        <div className="space-y-8">
          <CategorySection icon={<Backpack size={14} />} title="Owned" description="Active rewards — activate or redeem the ones that need it.">
            {active.length === 0 ? (
              <p className="text-sm text-subtle">No active rewards right now.</p>
            ) : (
              <div className="space-y-2">
                {active.map((p) => (
                  <Row key={p.id} p={p} busy={busyId === p.id} onAct={act} onToggle={toggleCosmetic} />
                ))}
              </div>
            )}
          </CategorySection>

          {history.length > 0 && (
            <CategorySection icon={<Clock size={14} />} title="History" description="Past purchases — expired, redeemed and refunded.">
              <div className="space-y-2">
                {history.map((p) => (
                  <Row key={p.id} p={p} busy={false} onAct={act} />
                ))}
              </div>
            </CategorySection>
          )}
        </div>
      )}
    </div>
  )
}

function Row({
  p,
  busy,
  onAct,
  onToggle,
}: {
  p: RewardPurchase
  busy: boolean
  onAct: (p: RewardPurchase, kind: 'activate' | 'redeem') => void
  onToggle?: (p: RewardPurchase, enabled: boolean) => void
}) {
  const cat = snapshotCategory(p)
  const meta = CATEGORY_META[cat]
  const name = String(p.reward_snapshot.name ?? 'Reward')
  const act = action(p)
  // Cosmetics (badges + the Corner HUD) are shown/hidden via a toggle rather than
  // activated/redeemed — disabled ones stop rendering on the profile / dashboard.
  const canToggle = cat === 'cosmetic' && p.status === 'active' && !isExpired(p)
  const status = canToggle
    ? { text: p.enabled ? 'Shown' : 'Hidden', color: p.enabled ? '#34d399' : 'var(--text-3)' }
    : statusLabel(p)

  return (
    <div className="flex items-center gap-3 rounded-xl border px-4 py-3" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--bg-2)', color: p.reward_snapshot.color ? String(p.reward_snapshot.color) : 'var(--p-1)' }}>
        <CategoryIcon category={cat} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        <p className="text-xs text-subtle">{meta.label} · <span style={{ color: status.color }}>{status.text}</span></p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-subtle">
        <Coins size={11} /> {formatCoins(p.cost)}
      </span>
      {canToggle && onToggle ? (
        <button
          type="button"
          role="switch"
          aria-checked={p.enabled}
          disabled={busy}
          onClick={() => onToggle(p, !p.enabled)}
          title={p.enabled ? 'Shown — click to hide' : 'Hidden — click to show'}
          className="relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-60"
          style={{ background: p.enabled ? 'var(--p-1)' : 'var(--line-strong)' }}
        >
          <span
            className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
            style={{ transform: p.enabled ? 'translateX(20px)' : 'translateX(0)' }}
          />
        </button>
      ) : act ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAct(p, act)}
          className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-60"
          style={{ background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : act === 'activate' ? 'Activate' : 'Redeem'}
        </button>
      ) : null}
    </div>
  )
}
