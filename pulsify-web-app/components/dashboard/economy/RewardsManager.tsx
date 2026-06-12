'use client'

import { useState } from 'react'
import { Gift, Plus, Pencil, Trash2, Coins, AlertCircle, Star } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CATEGORY_META, formatCoins, type ShopReward } from '@/lib/shop'
import { useShop } from '@/lib/use-shop'
import { CategoryIcon } from './category-icons'
import { RewardEditPanel, type RoleOption, type AchievementOption } from './RewardEditPanel'

type Props = {
  guildId: string
  guildName: string
  roles: RoleOption[]
  achievements: AchievementOption[]
}

export function RewardsManager({ guildId, guildName, roles, achievements }: Props) {
  const { data, loading, error, refresh } = useShop(guildId, { manage: true })
  const [editing, setEditing] = useState<ShopReward | null | 'new'>(null)
  const [deleting, setDeleting] = useState<ShopReward | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Only this guild's server rewards are editable here; the global catalogue is
  // operator-managed (Controls), so show but don't expose edit/delete for it.
  const serverRewards = (data?.rewards ?? []).filter((r) => r.scope === 'server')

  async function doDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/guilds/${guildId}/economy/shop/${deleting.id}`, { method: 'DELETE' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not delete the reward.')
      setDeleting(null)
      refresh()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete the reward.')
    } finally {
      setDeleteBusy(false)
    }
  }

  const header = (
    <PageHeader
      title="Rewards"
      helpId="rewards"
      description={
        <>
          Create the rewards members of <span className="font-medium text-foreground">{guildName}</span> can buy with Pulse Coins
        </>
      }
      action={
        <button
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
        >
          <Plus size={15} /> New reward
        </button>
      }
    />
  )

  if (loading) {
    return (
      <div className="page-content">
        {header}
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[60px]" />)}</div>
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

  const activeCount = serverRewards.filter((r) => r.active).length
  const featuredCount = serverRewards.filter((r) => r.featured).length

  return (
    <div className="page-content">
      {header}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatsCard label="Rewards" value={serverRewards.length} sub="Defined in this server" icon={<Gift size={16} />} accent="var(--p-1)" />
        <StatsCard label="Active" value={activeCount} sub="Visible in the shop" icon={<Coins size={16} />} accent="var(--green)" />
        <StatsCard label="Featured" value={featuredCount} sub="Pinned to the top" icon={<Star size={16} />} accent="var(--amber)" />
      </div>

      {serverRewards.length === 0 ? (
        <EmptyState
          icon={<Gift size={36} />}
          title="No rewards yet"
          description="Create your first reward — a role, perk, booster or cosmetic — and members can start spending their Pulse Coins."
          action={
            <button
              onClick={() => setEditing('new')}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
            >
              <Plus size={15} /> New reward
            </button>
          }
        />
      ) : (
        <div className="space-y-2">
          {serverRewards.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl border px-4 py-3" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', opacity: r.active ? 1 : 0.6 }}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--bg-2)', color: r.color ?? 'var(--p-1)' }}>
                <CategoryIcon category={r.category} size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {r.name}
                  {r.featured && <Star size={11} className="ml-1.5 inline" style={{ color: 'var(--amber)' }} />}
                  {!r.active && <span className="ml-2 text-[11px] text-subtle">(hidden)</span>}
                </p>
                <p className="text-xs text-subtle">
                  {CATEGORY_META[r.category].label}
                  {r.stock_remaining != null && ` · ${formatCoins(r.stock_remaining)}/${formatCoins(r.stock ?? 0)} in stock`}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 font-mono text-sm font-bold text-foreground">
                <Coins size={13} style={{ color: 'var(--p-1)' }} /> {formatCoins(r.cost)}
              </span>
              <button onClick={() => setEditing(r)} className="shrink-0 rounded-lg p-2 text-muted-foreground transition hover:text-foreground" aria-label="Edit" title="Edit">
                <Pencil size={15} />
              </button>
              <button onClick={() => { setDeleting(r); setDeleteError(null) }} className="shrink-0 rounded-lg p-2 transition" style={{ color: '#f87171' }} aria-label="Delete" title="Delete">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <RewardEditPanel
          guildId={guildId}
          roles={roles}
          achievements={achievements}
          editing={editing === 'new' ? null : editing}
          onClose={(changed) => {
            setEditing(null)
            if (changed) refresh()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          description="Members can no longer buy it. Existing purchases keep working (they carry a snapshot). This can't be undone."
          confirmLabel="Delete"
          tone="destructive"
          busy={deleteBusy}
          error={deleteError}
          onCancel={() => { if (!deleteBusy) setDeleting(null) }}
          onConfirm={doDelete}
        />
      )}
    </div>
  )
}
