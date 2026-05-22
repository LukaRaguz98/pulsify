import {
  Megaphone,
  BellRing,
  BarChart3,
  Users,
  Timer,
  Lock,
  CalendarPlus,
  UserMinus,
  Zap,
  type LucideIcon,
} from 'lucide-react'

// The action catalog (lib/automations.ts) stores its icon as a string so it can
// stay framework-agnostic and be mirrored by the bot. The dashboard resolves
// those names to lucide components here.
const ICONS: Record<string, LucideIcon> = {
  Megaphone,
  BellRing,
  BarChart3,
  Users,
  Timer,
  Lock,
  CalendarPlus,
  UserMinus,
}

export function ActionIcon({ name, size = 16 }: { name: string; size?: number }) {
  const Icon = ICONS[name] ?? Zap
  return <Icon size={size} />
}
