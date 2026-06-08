'use client'

import {
  Users,
  Hash,
  Zap,
  Shield,
  Compass,
  ShieldAlert,
  LifeBuoy,
  Gift,
  CalendarDays,
  Megaphone,
  Hand,
  CalendarClock,
  CalendarRange,
  Archive,
  type LucideIcon,
} from 'lucide-react'

// Icon-by-name resolver for the Backup Center. lib/backups.ts references icons
// by lucide name so it stays JSX-free; the UI resolves them here (mirrors
// templates/icons.tsx, milestones/icons.tsx).
const ICONS: Record<string, LucideIcon> = {
  Users,
  Hash,
  Zap,
  Shield,
  Compass,
  ShieldAlert,
  LifeBuoy,
  Gift,
  CalendarDays,
  Megaphone,
  Hand,
  CalendarClock,
  CalendarRange,
  Archive,
}

export function BackupIcon({ name, size = 16 }: { name: string; size?: number }) {
  const Icon = ICONS[name] ?? Archive
  return <Icon size={size} />
}
