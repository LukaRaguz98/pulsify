import { CheckCircle2, CircleSlash, Wrench, EyeOff, Lock, Users, ShieldCheck } from 'lucide-react'
import {
  CATEGORY_META,
  PERMISSION_META,
  type CommandCategory,
  type CommandPermissionLevel,
  type CommandStatus,
} from '@/lib/commands'
import type { CommandLogStatus } from '@/app/api/guilds/[guildId]/commands/logs/route'

function Pill({
  children,
  color,
  bg,
  border,
}: {
  children: React.ReactNode
  color: string
  bg: string
  border: string
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none"
      style={{ color, background: bg, borderColor: border }}
    >
      {children}
    </span>
  )
}

const STATUS_STYLE: Record<
  CommandStatus,
  { label: string; color: string; bg: string; border: string; icon: React.ReactNode }
> = {
  enabled: {
    label: 'Enabled',
    color: '#22c55e',
    bg: 'rgba(34,197,94,0.1)',
    border: 'rgba(34,197,94,0.4)',
    icon: <CheckCircle2 size={11} />,
  },
  disabled: {
    label: 'Disabled',
    color: 'var(--text-3)',
    bg: 'var(--panel)',
    border: 'var(--line-strong)',
    icon: <CircleSlash size={11} />,
  },
  maintenance: {
    label: 'Maintenance',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.1)',
    border: 'rgba(245,158,11,0.4)',
    icon: <Wrench size={11} />,
  },
}

export function StatusBadge({ status }: { status: CommandStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <Pill color={s.color} bg={s.bg} border={s.border}>
      {s.icon}
      {s.label}
    </Pill>
  )
}

export function CategoryBadge({ category }: { category: CommandCategory }) {
  return (
    <Pill color="var(--text-2)" bg="var(--bg-2)" border="var(--line-strong)">
      {CATEGORY_META[category].label}
    </Pill>
  )
}

const PERMISSION_STYLE: Record<
  CommandPermissionLevel,
  { color: string; bg: string; border: string; icon: React.ReactNode }
> = {
  everyone: {
    color: 'var(--text-3)',
    bg: 'var(--bg-2)',
    border: 'var(--line-strong)',
    icon: <Users size={11} />,
  },
  moderator: {
    color: '#60a5fa',
    bg: 'rgba(96,165,250,0.1)',
    border: 'rgba(96,165,250,0.35)',
    icon: <ShieldCheck size={11} />,
  },
  admin: {
    color: '#a855f7',
    bg: 'rgba(168,85,247,0.1)',
    border: 'rgba(168,85,247,0.35)',
    icon: <Lock size={11} />,
  },
}

export function PermissionBadge({ level }: { level: CommandPermissionLevel }) {
  const s = PERMISSION_STYLE[level]
  return (
    <Pill color={s.color} bg={s.bg} border={s.border}>
      {s.icon}
      {PERMISSION_META[level].label}
    </Pill>
  )
}

export function HiddenBadge() {
  return (
    <Pill color="var(--text-3)" bg="var(--bg-2)" border="var(--line-strong)">
      <EyeOff size={11} />
      Hidden
    </Pill>
  )
}

export const LOG_STATUS_STYLE: Record<
  CommandLogStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  success: { label: 'Success', color: '#22c55e', bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.35)' },
  failed: { label: 'Failed', color: '#f87171', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.35)' },
  denied: { label: 'Denied', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.35)' },
  cooldown: { label: 'Cooldown', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.35)' },
  rate_limited: { label: 'Rate limited', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.35)' },
  maintenance: { label: 'Maintenance', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.35)' },
  disabled: { label: 'Disabled', color: 'var(--text-3)', bg: 'var(--panel)', border: 'var(--line-strong)' },
}

export function LogStatusBadge({ status }: { status: CommandLogStatus }) {
  const s = LOG_STATUS_STYLE[status]
  return (
    <Pill color={s.color} bg={s.bg} border={s.border}>
      {s.label}
    </Pill>
  )
}
