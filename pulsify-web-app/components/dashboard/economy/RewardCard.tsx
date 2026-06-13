'use client'

import { useState } from 'react'
import { Coins, Lock, Check, Star, Globe, Loader2, Eye, Pencil, Trash2 } from 'lucide-react'
import {
  CATEGORY_META,
  meetsRequirements,
  inStock,
  hasRequirements,
  formatCoins,
  rolePayload,
  boosterPayload,
  giveawayEntryPayload,
  type ShopReward,
  type RequirementContext,
} from '@/lib/shop'
import { CategoryIcon } from './category-icons'
import { CosmeticPreview } from './CosmeticPreview'

type Props = {
  reward: ShopReward
  ownedCount: number
  context: RequirementContext
  busy?: boolean
  onBuy: (reward: ShopReward) => void
  /** Admin management (server rewards only): renders edit/delete controls. */
  onEdit?: (reward: ShopReward) => void
  onDelete?: (reward: ShopReward) => void
}

/** One-line summary of what the reward gives, derived from its payload. */
function rewardDetail(reward: ShopReward): string | null {
  switch (reward.category) {
    case 'role': {
      const { durationDays } = rolePayload(reward)
      return durationDays ? `Role for ${durationDays} day${durationDays === 1 ? '' : 's'}` : 'Permanent role'
    }
    case 'xp_booster': {
      const { multiplier, durationHours } = boosterPayload(reward)
      return `${multiplier}× XP for ${durationHours}h`
    }
    case 'giveaway_entry': {
      const { entries } = giveawayEntryPayload(reward)
      return `${entries} bonus giveaway ${entries === 1 ? 'entry' : 'entries'}`
    }
    case 'perk':
      return 'Staff fulfil it after you redeem'
    case 'cosmetic':
      return reward.payload.effect === 'corner_hud' ? 'Unlocks a dashboard decoration' : 'Profile badge'
    default:
      return null
  }
}

export function RewardCard({ reward, ownedCount, context, busy, onBuy, onEdit, onDelete }: Props) {
  const [showPreview, setShowPreview] = useState(false)
  const isCosmetic = reward.category === 'cosmetic'
  const meta = CATEGORY_META[reward.category]
  const gate = meetsRequirements(reward, context)
  const stockOk = inStock(reward)
  const limitReached = reward.per_user_limit != null && ownedCount >= reward.per_user_limit
  const detail = rewardDetail(reward)
  // Hidden = an inactive server reward (only ever visible to admins, who fetch
  // in manage mode); members never receive inactive rewards from the API.
  const hidden = reward.active === false

  const disabled = busy || hidden || !gate.ok || !stockOk || limitReached
  const buyLabel = hidden
    ? 'Hidden'
    : limitReached
      ? 'Owned'
      : !stockOk
        ? 'Sold out'
        : !gate.ok
          ? 'Locked'
          : 'Buy'

  return (
    <div
      className="flex flex-col rounded-xl border p-4 transition-colors"
      style={{
        background: 'var(--panel)',
        borderColor: reward.featured ? 'var(--p-soft)' : 'var(--line-strong)',
        opacity: hidden ? 0.6 : 1,
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium"
          style={{ background: 'var(--bg-2)', color: reward.color ?? 'var(--p-1)' }}
          title={meta.howItWorks}
        >
          <CategoryIcon category={reward.category} size={12} />
          {meta.label}
        </span>
        <div className="flex items-center gap-1.5">
          {reward.scope === 'global' && (
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}
              title="Available in every Pulse server"
            >
              <Globe size={10} /> Global
            </span>
          )}
          {reward.featured && <Star size={12} style={{ color: 'var(--amber)' }} aria-label="Featured" />}
          {/* Admin controls (server rewards only). */}
          {onEdit && (
            <button onClick={() => onEdit(reward)} className="rounded-md p-1 text-muted-foreground transition hover:text-foreground" aria-label="Edit reward" title="Edit">
              <Pencil size={13} />
            </button>
          )}
          {onDelete && (
            <button onClick={() => onDelete(reward)} className="rounded-md p-1 transition" style={{ color: '#f87171' }} aria-label="Delete reward" title="Delete">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <p className="truncate font-semibold text-foreground" title={reward.name}>
        {reward.name}
      </p>
      {reward.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{reward.description}</p>
      )}
      {detail && <p className="mt-1 text-[11px] text-subtle">{detail}</p>}

      {/* Cosmetic preview — see how it looks before buying. */}
      {isCosmetic && (
        <>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="mt-2 inline-flex w-fit items-center gap-1 text-[11px] font-medium transition-colors"
            style={{ color: 'var(--p-1)' }}
          >
            <Eye size={12} /> {showPreview ? 'Hide preview' : 'Preview'}
          </button>
          {showPreview && (
            <div className="mt-2">
              <CosmeticPreview
                effect={String(reward.payload.effect ?? 'badge')}
                name={reward.name}
                color={reward.color ?? 'var(--p-1)'}
              />
            </div>
          )}
        </>
      )}

      {/* Requirement chips */}
      {hasRequirements(reward) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {reward.requirements.min_reputation != null && (
            <Req met={context.reputation >= reward.requirements.min_reputation} label={`${reward.requirements.min_reputation}+ rep`} />
          )}
          {reward.requirements.min_level != null && (
            <Req met={context.level >= reward.requirements.min_level} label={`Lvl ${reward.requirements.min_level}+`} />
          )}
          {!!reward.requirements.achievement_ids?.length && (
            <Req
              met={reward.requirements.achievement_ids.every((id) => context.achievementIds.includes(id))}
              label={`${reward.requirements.achievement_ids.length} achievement${reward.requirements.achievement_ids.length === 1 ? '' : 's'}`}
            />
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-mono text-sm font-bold text-foreground">
          <Coins size={14} style={{ color: 'var(--p-1)' }} />
          {formatCoins(reward.cost)}
        </span>
        {reward.stock_remaining != null && (
          <span className="text-[11px] text-subtle">{formatCoins(reward.stock_remaining)} left</span>
        )}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onBuy(reward)}
        title={!gate.ok ? gate.reasons.join(' ') : undefined}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          background:
            disabled && buyLabel !== 'Owned'
              ? 'var(--bg-2)'
              : 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
          color: disabled && buyLabel !== 'Owned' ? 'var(--text-3)' : '#fff',
          boxShadow: disabled ? 'none' : '0 4px 14px -4px var(--p-glow)',
        }}
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : limitReached ? (
          <Check size={14} />
        ) : !gate.ok || !stockOk ? (
          <Lock size={14} />
        ) : (
          <Coins size={14} />
        )}
        {buyLabel}
      </button>
    </div>
  )
}

function Req({ met, label }: { met: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        background: met ? 'rgba(16,185,129,0.12)' : 'var(--bg-2)',
        color: met ? '#34d399' : 'var(--text-3)',
      }}
    >
      {met && <Check size={9} />}
      {label}
    </span>
  )
}
