import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import type { Reputation, RiskAssessment, RiskLevel } from '@/lib/reputation'

function tint(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}

/** Coloured reputation pill — score plus tier label. */
export function ReputationBadge({
  reputation,
  size = 'md',
  showLabel = true,
}: {
  reputation: Reputation
  size?: 'sm' | 'md'
  showLabel?: boolean
}) {
  const { score, label, color } = reputation
  const pad = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md font-medium ${pad}`}
      style={{ background: tint(color, 14), color }}
      title={`Reputation ${score}/100 — ${label}`}
    >
      <span className="font-mono font-bold tabular-nums">{score}</span>
      {showLabel && <span className="opacity-90">{label}</span>}
    </span>
  )
}

const RISK_ICON: Record<RiskLevel, React.ReactNode> = {
  none: <ShieldCheck size={12} />,
  low: <ShieldCheck size={12} />,
  medium: <ShieldQuestion size={12} />,
  high: <ShieldAlert size={12} />,
}

/**
 * Risk indicator. Renders nothing for a clear record unless `alwaysShow` is set
 * (the profile page shows the explicit "Clear" state; the directory hides it to
 * keep clean rows uncluttered).
 */
export function RiskBadge({
  risk,
  alwaysShow = false,
}: {
  risk: RiskAssessment
  alwaysShow?: boolean
}) {
  if (risk.level === 'none' && !alwaysShow) {
    return <span className="text-xs text-subtle">—</span>
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium"
      style={{ background: tint(risk.color, 14), color: risk.color }}
      title={risk.reasons.length ? risk.reasons.join(' · ') : risk.label}
    >
      {RISK_ICON[risk.level]}
      {risk.label}
    </span>
  )
}
