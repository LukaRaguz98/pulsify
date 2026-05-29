'use client'

import {
  Gamepad2,
  Eye,
  Headphones,
  Trophy,
  Radio,
  Sparkles,
  ShieldAlert,
  Users,
  CalendarClock,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

// Resolve a lucide icon NAME (the string convention used in lib/presence.ts —
// ACTIVITY_KINDS, PRESENCE_PRESETS) into a component. Mirrors
// components/dashboard/giveaways/icons.tsx. Falls back to Sparkles.
const ICONS: Record<string, LucideIcon> = {
  Gamepad2,
  Eye,
  Headphones,
  Trophy,
  Radio,
  Sparkles,
  ShieldAlert,
  Users,
  CalendarClock,
  Wrench,
}

export function PresenceIcon({ name, size = 16 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? Sparkles
  return <C size={size} />
}
