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
import { avatarUrl, defaultAvatarUrl } from '@/lib/discord'
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

/**
 * Discord avatar hashes for the users referenced by the invite tables, keyed by
 * user id. Only members currently in the guild are resolvable — everyone else
 * (departed joins, inviters who left) falls back to Discord's default avatar,
 * the same treatment the "Richest" board gives out-of-guild wallet holders.
 */
export type AvatarMap = Record<string, string>

export function inviteAvatarUrl(userId: string, avatars: AvatarMap | undefined): string {
  const hash = avatars?.[userId]
  return hash ? avatarUrl(userId, hash) : defaultAvatarUrl(userId)
}

/** Tone → CSS colour for status chips. */
export const STATUS_COLOR: Record<InviteStatus, string> = {
  valid: '#22c55e',
  pending: '#f59e0b',
  invalid: '#94a3b8',
  fake: '#ef4444',
  left: '#94a3b8',
}
