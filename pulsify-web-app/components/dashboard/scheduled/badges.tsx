import {
  CheckCircle2,
  XCircle,
  CircleSlash,
  RotateCw,
  Power,
  PauseCircle,
} from 'lucide-react'
import type { RunStatus } from '@/lib/automations'
import type { AutomationRunStatus } from '@/app/api/guilds/[guildId]/automations/logs/route'

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

export const RUN_STATUS_STYLE: Record<
  AutomationRunStatus,
  { label: string; color: string; bg: string; border: string; icon: React.ReactNode }
> = {
  success: { label: 'Success', color: '#22c55e', bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.35)', icon: <CheckCircle2 size={11} /> },
  failed: { label: 'Failed', color: '#f87171', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.35)', icon: <XCircle size={11} /> },
  skipped: { label: 'Skipped', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.35)', icon: <CircleSlash size={11} /> },
  retrying: { label: 'Retrying', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.35)', icon: <RotateCw size={11} /> },
}

export function RunStatusBadge({ status }: { status: AutomationRunStatus }) {
  const s = RUN_STATUS_STYLE[status]
  return (
    <Pill color={s.color} bg={s.bg} border={s.border}>
      {s.icon}
      {s.label}
    </Pill>
  )
}

/** Status of a workflow itself — enabled/disabled plus its last run outcome. */
export function WorkflowStatusBadge({
  enabled,
  lastStatus,
}: {
  enabled: boolean
  lastStatus: RunStatus | null
}) {
  if (!enabled) {
    return (
      <Pill color="var(--text-3)" bg="var(--panel)" border="var(--line-strong)">
        <PauseCircle size={11} />
        Paused
      </Pill>
    )
  }
  if (lastStatus === 'failed') {
    return (
      <Pill color="#f87171" bg="rgba(239,68,68,0.1)" border="rgba(239,68,68,0.35)">
        <XCircle size={11} />
        Last run failed
      </Pill>
    )
  }
  return (
    <Pill color="#22c55e" bg="rgba(34,197,94,0.1)" border="rgba(34,197,94,0.35)">
      <Power size={11} />
      Active
    </Pill>
  )
}
