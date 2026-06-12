'use client'

import { useState } from 'react'
import { Globe, Plus, Pencil, Trash2, Coins, Star, AlertCircle } from 'lucide-react'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CATEGORY_META, formatCoins, type ShopReward } from '@/lib/shop'
import { useShop } from '@/lib/use-shop'
import { CategoryIcon } from './category-icons'
import { RewardEditPanel } from './RewardEditPanel'

type Props = { guildId: string }

const newBtn =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white'
const newBtnStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
  boxShadow: '0 4px 14px -4px var(--p-glow)',
}

/**
 * Operator-only management of the GLOBAL catalogue — cosmetics (badges + the
 * Animated Corner HUD) shown in every server's shop. Reuses the shop list (which
 * already returns global rewards) and the shared RewardEditPanel in `scope="global"`
 * mode; the shop create/edit/delete APIs authorise global writes via requireOperator.
 */
export function GlobalCatalogueManager({ guildId }: Props) {
  const { data, loading, error, refresh } = useShop(guildId, { manage: true })
  const [editing, setEditing] = useState<ShopReward | null | 'new'>(null)
  const [deleting, setDeleting] = useState<ShopReward | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const globalRewards = (data?.rewards ?? []).filter((r) => r.scope === 'global')

  async function doDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/guilds/${guildId}/economy/shop/${deleting.id}`, { method: 'DELETE' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not delete the cosmetic.')
      setDeleting(null)
      refresh()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete the cosmetic.')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <SectionCard
      title="Global catalogue"
      description="Operator-managed cosmetics shown in every server's shop — profile badges and the Animated Corner HUD. Reputation is computed, never granted, so it has no cosmetic here."
    >
      <div className="mb-4 flex justify-end">
        <button onClick={() => setEditing('new')} className={newBtn} style={newBtnStyle}>
          <Plus size={15} /> New global cosmetic
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[60px]" />)}</div>
      ) : error ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle size={16} style={{ color: '#f87171' }} /> {error}
        </p>
      ) : globalRewards.length === 0 ? (
        <EmptyState
          icon={<Globe size={32} />}
          title="No global cosmetics yet"
          description="Create badges or decorations that appear in every server's shop, independent of what each server adds."
          variant="muted"
        />
      ) : (
        <div className="space-y-2">
          {globalRewards.map((r) => (
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
                  {r.payload.effect === 'corner_hud' && ' · Corner HUD'}
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
          roles={[]}
          achievements={[]}
          scope="global"
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
          description="It disappears from every server's shop. Existing purchases keep working (they carry a snapshot). This can't be undone."
          confirmLabel="Delete"
          tone="destructive"
          busy={deleteBusy}
          error={deleteError}
          onCancel={() => { if (!deleteBusy) setDeleting(null) }}
          onConfirm={doDelete}
        />
      )}
    </SectionCard>
  )
}
