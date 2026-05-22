'use client'

import { Award, ShieldAlert } from 'lucide-react'
import type { Reputation, RiskAssessment } from '@/lib/reputation'

export function ReputationPanel({
  reputation,
  risk,
}: {
  reputation: Reputation
  risk: RiskAssessment
}) {
  const positives = reputation.breakdown.filter((b) => b.points >= 0)
  const penalty = reputation.breakdown.find((b) => b.label === 'Moderation history')
  const maxComponent = Math.max(...positives.map((b) => b.points), 1)

  return (
    <div className="space-y-5">
      {/* Score header */}
      <div className="flex items-end gap-4">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-4xl font-bold tabular-nums" style={{ color: reputation.color }}>
              {reputation.score}
            </span>
            <span className="text-sm text-subtle">/100</span>
          </div>
          <span
            className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
            style={{ background: `color-mix(in srgb, ${reputation.color} 14%, transparent)`, color: reputation.color }}
          >
            <Award size={12} />
            {reputation.label}
          </span>
        </div>
        <div className="mb-1 flex-1">
          <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
            <div className="h-2 rounded-full transition-all" style={{ width: `${reputation.score}%`, background: reputation.color }} />
          </div>
        </div>
      </div>

      {/* Component breakdown */}
      <div className="space-y-2">
        {positives.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-xs text-muted-foreground">{b.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
              <div className="h-1.5 rounded-full" style={{ width: `${(b.points / maxComponent) * 100}%`, background: 'var(--p-1)' }} />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-xs text-subtle">+{b.points}</span>
          </div>
        ))}
        {penalty && penalty.points < 0 && (
          <div className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-xs text-muted-foreground">Moderation history</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
              <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, -penalty.points)}%`, background: 'var(--red)' }} />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-xs" style={{ color: 'var(--red)' }}>{penalty.points}</span>
          </div>
        )}
      </div>

      {/* Risk */}
      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ShieldAlert size={13} />
            Moderation risk
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
            style={{ background: `color-mix(in srgb, ${risk.color} 14%, transparent)`, color: risk.color }}
          >
            {risk.label}
          </span>
        </div>
        {risk.reasons.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {risk.reasons.map((reason) => (
              <li key={reason} className="rounded px-1.5 py-0.5 text-[11px] text-subtle" style={{ background: 'var(--panel)' }}>
                {reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
