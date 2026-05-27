import { ShieldAlert, ShieldCheck, ShieldQuestion, Sparkles } from 'lucide-react'
import type { Reputation, RiskAssessment, RiskLevel } from '@/lib/reputation'
import { levelBadge, progressInLevel, type LevelCurve } from '@/lib/leveling'

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

/** Coloured level pill — "Lvl N", tinted by the level tier. */
export function LevelBadge({
  level,
  size = 'md',
  showTier = false,
}: {
  level: number
  size?: 'sm' | 'md'
  showTier?: boolean
}) {
  const { label, color } = levelBadge(level)
  const pad = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md font-medium ${pad}`}
      style={{ background: tint(color, 14), color }}
      title={`Level ${level} — ${label}`}
    >
      <Sparkles size={size === 'sm' ? 10 : 12} />
      <span className="font-mono font-bold tabular-nums">Lvl {level}</span>
      {showTier && <span className="opacity-90">{label}</span>}
    </span>
  )
}

/**
 * Animated XP progress bar to the next level. `xp` is the member's total XP;
 * `curve` comes from the directory/profile response. The `.xp-bar` fill is
 * animated in globals.css (auto-neutralised under [data-animations="false"]).
 */
export function XpProgress({
  xp,
  curve,
  showLabel = true,
  className,
}: {
  xp: number
  curve: LevelCurve
  showLabel?: boolean
  className?: string
}) {
  const p = progressInLevel(xp, curve)
  return (
    <div className={className}>
      {showLabel && (
        <div className="mb-1 flex items-center justify-between text-[10px] text-subtle">
          <span>Lvl {p.level}</span>
          <span className="font-mono">
            {p.intoLevel.toLocaleString()} / {p.span.toLocaleString()} XP
          </span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
        <div className="xp-bar h-1.5 rounded-full" style={{ width: `${p.pct}%`, background: 'var(--p-1)' }} />
      </div>
    </div>
  )
}
