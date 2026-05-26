'use client'

import {
  Gift,
  Trophy,
  Radio,
  CalendarClock,
  Ban,
  Zap,
  Users,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

// Resolve a lucide icon NAME (the string convention used across lib/giveaways.ts
// — STATUS_META, presets) into a component. Mirrors components/dashboard/
// tickets/icons.tsx. Falls back to Gift for anything unmapped.
const ICONS: Record<string, LucideIcon> = {
  Gift,
  Trophy,
  Radio,
  CalendarClock,
  Ban,
  Zap,
  Users,
  Sparkles,
}

export function GiveawayIcon({ name, size = 16 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? Gift
  return <C size={size} />
}
