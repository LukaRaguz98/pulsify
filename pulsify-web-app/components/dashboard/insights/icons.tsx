import {
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  ShieldAlert,
  ShieldX,
  Lock,
  Sparkles,
  AlertOctagon,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  Flame,
  Hand,
  Mic,
  Hash,
  Users,
  Rocket,
  MessageSquare,
  UserPlus,
  Terminal,
  Clock,
  type LucideIcon,
} from 'lucide-react'

// The insights engine (lib/insights.ts) stores icons as strings so it stays
// framework-free and portable to the future Pulse pipeline. The UI resolves
// those names to lucide components here — same convention as the command
// palette and scheduled-automation catalogs.
const ICONS: Record<string, LucideIcon> = {
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  ShieldAlert,
  ShieldX,
  Lock,
  Sparkles,
  AlertOctagon,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  Flame,
  Hand,
  Mic,
  Hash,
  Users,
  Rocket,
  MessageSquare,
  UserPlus,
  Terminal,
  Clock,
}

export function InsightIcon({
  name,
  size = 16,
  className,
}: {
  name: string
  size?: number
  className?: string
}) {
  const Icon = ICONS[name] ?? Sparkles
  return <Icon size={size} className={className} />
}
