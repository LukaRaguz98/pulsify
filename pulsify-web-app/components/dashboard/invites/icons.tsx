'use client'

import {
  Gift,
  Coins,
  Sparkles,
  Users,
  Clock,
  ShoppingBag,
  Award,
  Crown,
  Star,
  UserPlus,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import type { InviteRewardType, InviteStatus } from '@/lib/invites'

const REWARD_ICONS: Record<InviteRewardType, LucideIcon> = {
  coins: Coins,
  xp: Sparkles,
  role: Users,
  temp_role: Clock,
  shop_item: ShoppingBag,
  custom: Award,
}

export function RewardTypeIcon({ type, size = 14 }: { type: InviteRewardType; size?: number }) {
  const Icon = REWARD_ICONS[type] ?? Gift
  return <Icon size={size} />
}

/** Named lucide icons available for the reward-card icon picker. */
export const REWARD_CARD_ICONS: Record<string, LucideIcon> = {
  Gift,
  Crown,
  Sparkles,
  Award,
  Star,
  UserPlus,
  ShieldCheck,
  Coins,
}

export function RewardCardIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = REWARD_CARD_ICONS[name] ?? Gift
  return <Icon size={size} />
}

/** Tone → CSS colour for status chips. */
export const STATUS_COLOR: Record<InviteStatus, string> = {
  valid: '#22c55e',
  pending: '#f59e0b',
  invalid: '#94a3b8',
  fake: '#ef4444',
  left: '#94a3b8',
}
