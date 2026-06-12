import { Shield, Gift, Palette, Zap, Ticket } from 'lucide-react'
import type { RewardCategory } from '@/lib/shop'

const MAP: Record<RewardCategory, React.ComponentType<{ size?: number }>> = {
  role: Shield,
  xp_booster: Zap,
  giveaway_entry: Ticket,
  perk: Gift,
  cosmetic: Palette,
}

/** Reward-category icon (maps lib/shop CATEGORY_META.icon to a component). */
export function CategoryIcon({ category, size = 16 }: { category: RewardCategory; size?: number }) {
  const Icon = MAP[category] ?? Gift
  return <Icon size={size} />
}
