'use client'

import {
  BarChart3,
  Radio,
  CalendarClock,
  CheckCircle2,
  Archive,
  CircleDot,
  ListChecks,
  ToggleLeft,
  Star,
  Sparkles,
  Landmark,
  type LucideIcon,
} from 'lucide-react'

// Resolve a lucide icon NAME (the string convention used across lib/polls.ts —
// STATUS_META, POLL_TYPE_META, presets) into a component. Mirrors
// components/dashboard/giveaways/icons.tsx. Falls back to BarChart3.
const ICONS: Record<string, LucideIcon> = {
  BarChart3,
  Radio,
  CalendarClock,
  CheckCircle2,
  Archive,
  CircleDot,
  ListChecks,
  ToggleLeft,
  Star,
  Sparkles,
  Landmark,
}

export function PollIcon({ name, size = 16 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? BarChart3
  return <C size={size} />
}
