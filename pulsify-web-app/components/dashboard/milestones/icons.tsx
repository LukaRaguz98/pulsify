'use client'

import {
  Award,
  Crown,
  Medal,
  Trophy,
  Star,
  CalendarClock,
  CalendarDays,
  MessageSquare,
  Mic,
  Gift,
  Sparkles,
  TrendingUp,
  Flame,
  Heart,
  Shield,
  Gem,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'

// Resolve a lucide icon NAME (the string convention used across lib/milestones.ts
// — METRIC_META, MILESTONE_PRESETS, milestone.icon) into a component. Mirrors
// components/dashboard/giveaways/icons.tsx. Falls back to Award for anything
// unmapped.
const ICONS: Record<string, LucideIcon> = {
  Award,
  Crown,
  Medal,
  Trophy,
  Star,
  CalendarClock,
  CalendarDays,
  MessageSquare,
  Mic,
  Gift,
  Sparkles,
  TrendingUp,
  Flame,
  Heart,
  Shield,
  Gem,
  UserPlus,
}

/** Icon names offered in the editor's icon picker. */
export const MILESTONE_ICON_CHOICES: string[] = [
  'Award',
  'Crown',
  'Medal',
  'Trophy',
  'Star',
  'Gem',
  'Flame',
  'Heart',
  'Shield',
  'Sparkles',
  'CalendarClock',
  'MessageSquare',
  'Mic',
  'Gift',
  'TrendingUp',
  'UserPlus',
]

export function MilestoneIcon({ name, size = 16 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? Award
  return <C size={size} />
}
