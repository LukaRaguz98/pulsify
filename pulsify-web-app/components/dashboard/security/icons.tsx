'use client'

import {
  Activity,
  TerminalSquare,
  XCircle,
  LifeBuoy,
  Gift,
  FileText,
  Plug,
  UserPlus,
  MessageSquareWarning,
  Bell,
  Timer,
  ShieldOff,
  PowerOff,
  UserX,
  FileX,
  Lock,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Siren,
  type LucideIcon,
} from 'lucide-react'
import { SEVERITY_META, type SecuritySeverity } from '@/lib/security'

// Lucide icons referenced BY NAME from lib/security.ts (which is framework-free),
// resolved here in the UI layer — same trick polls/giveaways use.
const ICONS: Record<string, LucideIcon> = {
  Activity,
  TerminalSquare,
  XCircle,
  LifeBuoy,
  Gift,
  FileText,
  Plug,
  UserPlus,
  MessageSquareWarning,
  Bell,
  Timer,
  ShieldOff,
  PowerOff,
  UserX,
  FileX,
  Lock,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Siren,
}

export function SecurityIcon({ name, size = 16 }: { name: string; size?: number }) {
  const Icon = ICONS[name] ?? Shield
  return <Icon size={size} />
}

export function SeverityBadge({ severity }: { severity: SecuritySeverity }) {
  const meta = SEVERITY_META[severity]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: meta.bg, color: meta.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

export function StatusBadge({ status }: { status: 'open' | 'mitigated' | 'resolved' }) {
  const map = {
    open: { label: 'Open', color: '#f59e0b' },
    mitigated: { label: 'Mitigated', color: '#3b82f6' },
    resolved: { label: 'Resolved', color: '#22c55e' },
  } as const
  const m = map[status]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ borderColor: `${m.color}55`, color: m.color }}
    >
      {m.label}
    </span>
  )
}
