import {
  CircleDot,
  UserCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Minus,
  AlertOctagon,
  Ticket,
  Hand,
  Undo2,
  RotateCcw,
  PenLine,
  UserPlus,
  UserMinus,
  Flag,
  StickyNote,
  Trash2,
  LayoutPanelTop,
  Clock,
  XCircle,
  HelpCircle,
  Send,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'

// lib/tickets.ts stores icon names as strings (framework-free, mirrored by the
// bot) — same convention as the insights/command-palette catalogs. The UI
// resolves them to lucide components here.
const ICONS: Record<string, LucideIcon> = {
  CircleDot,
  UserCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Minus,
  AlertOctagon,
  Ticket,
  Hand,
  Undo2,
  RotateCcw,
  PenLine,
  UserPlus,
  UserMinus,
  Flag,
  StickyNote,
  Trash2,
  LayoutPanelTop,
  Clock,
  XCircle,
  HelpCircle,
  Send,
  RefreshCw,
}

export function TicketIcon({
  name,
  size = 14,
  className,
}: {
  name: string
  size?: number
  className?: string
}) {
  const Icon = ICONS[name] ?? Ticket
  return <Icon size={size} className={className} />
}
