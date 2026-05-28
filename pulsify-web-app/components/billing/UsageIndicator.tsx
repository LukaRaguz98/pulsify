'use client'

import { Sparkles } from 'lucide-react'
import Link from 'next/link'
import { formatLimit, type Plan, PLAN_LABELS } from '@/lib/billing'

/**
 * Slim usage bar shown above paginated lists / quota-bound features
 * (giveaways count, ticket count, automations count). Renders the live usage
 * vs the plan limit and an "Upgrade to X" tail when the user is at ≥80%.
 *
 * Uses CSS-var-tinted styling so it inherits the active accent — same visual
 * treatment as the rest of the dashboard.
 */
export function UsageIndicator({
  label,
  used,
  limit,
  nextPlan,
  className = '',
}: {
  label: string
  used: number
  /** Plan limit; `Infinity` = unlimited (no bar). */
  limit: number
  /** Optional: the plan tier they'd upgrade to. Shown as the upsell CTA. */
  nextPlan?: Plan
  className?: string
}) {
  if (!Number.isFinite(limit)) {
    return (
      <p className={`text-xs ${className}`} style={{ color: 'var(--text-3)' }}>
        {label}: <span className="font-semibold text-foreground">{used.toLocaleString()}</span> · Unlimited
      </p>
    )
  }
  const pct = Math.min(100, (used / Math.max(limit, 1)) * 100)
  const nearLimit = pct >= 80
  const overLimit = used >= limit
  return (
    <div className={className}>
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: 'var(--text-3)' }}>
          {label}: <span className="font-semibold text-foreground">{used.toLocaleString()} / {formatLimit(limit)}</span>
        </span>
        {nextPlan && nearLimit && (
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1 text-[11px] font-semibold"
            style={{ color: 'var(--p-1)' }}
          >
            <Sparkles size={11} /> Upgrade to {PLAN_LABELS[nextPlan]}
          </Link>
        )}
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--bg-2)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: overLimit ? '#ef4444' : nearLimit ? '#fbbf24' : 'var(--p-1)',
          }}
        />
      </div>
    </div>
  )
}
