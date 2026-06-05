import {
  Flame,
  LifeBuoy,
  Clock,
  Inbox,
  UserMinus,
  Star,
  Scale,
  CheckCircle2,
  Shield,
  Crown,
  UserCog,
  type LucideIcon,
} from 'lucide-react'

// The management engine (lib/management.ts) stores icons as strings so it stays
// framework-free. The UI resolves those names to lucide components here — same
// convention as the insights/command-palette catalogs.
const ICONS: Record<string, LucideIcon> = {
  Flame,
  LifeBuoy,
  Clock,
  Inbox,
  UserMinus,
  Star,
  Scale,
  CheckCircle2,
  Shield,
  Crown,
  UserCog,
}

export function ManagementIcon({
  name,
  size = 16,
  className,
}: {
  name: string
  size?: number
  className?: string
}) {
  const Icon = ICONS[name] ?? Star
  return <Icon size={size} className={className} />
}
