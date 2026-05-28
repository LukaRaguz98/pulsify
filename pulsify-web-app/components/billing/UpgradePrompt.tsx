'use client'

import Link from 'next/link'
import { Lock, Sparkles } from 'lucide-react'
import { PLAN_LABELS, type Plan } from '@/lib/billing'

/**
 * Inline upsell card — drops into any feature surface where a Pro/Business
 * feature is hidden behind a plan gate. Two flavours:
 *
 *  <UpgradePrompt requiredPlan="pro" feature="Pulse Guard" />
 *    Full-card placeholder that REPLACES the feature panel when locked.
 *
 *  <UpgradePrompt requiredPlan="business" variant="badge" />
 *    Small badge / pill suitable for sidebar items, table rows, action menus.
 *
 * Always routes to /pricing — the in-app upgrade source of truth. The visual
 * lock + animated sparkle nudges the upgrade without being aggressive (matches
 * the polish-pass design system tone from PULSIFY-23).
 */

type Props = {
  /** The minimum plan this feature needs. */
  requiredPlan: Plan
  /** User-facing feature name shown in the headline. */
  feature?: string
  /** Optional explainer below the headline. */
  description?: string
  /** 'card' = full panel replacement, 'badge' = inline pill. */
  variant?: 'card' | 'badge'
  /** Optional extra CTA href (e.g. specific anchor on /pricing). */
  href?: string
  className?: string
}

export function UpgradePrompt({
  requiredPlan,
  feature,
  description,
  variant = 'card',
  href = '/pricing',
  className = '',
}: Props) {
  const label = PLAN_LABELS[requiredPlan]

  if (variant === 'badge') {
    return (
      <Link
        href={href}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${className}`}
        style={{
          background: 'var(--p-soft)',
          color: 'var(--p-1)',
          borderColor: 'color-mix(in srgb, var(--p-1) 35%, transparent)',
        }}
        title={`Upgrade to ${label} to unlock ${feature ?? 'this feature'}`}
      >
        <Lock size={10} /> {label}
      </Link>
    )
  }

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-8 text-center ${className}`}
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      {/* Decorative glow — a subtle accent halo that draws the eye without
          obscuring the copy. Uses the user's active theme accent so the prompt
          feels native to whatever colour the dashboard is set to. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 mx-auto h-64 w-64 rounded-full opacity-50"
        style={{ background: 'radial-gradient(circle, var(--p-glow), transparent 70%)' }}
      />
      <div
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
      >
        <Lock size={22} />
      </div>
      <h3 className="mt-5 text-xl font-bold text-foreground">
        {feature ? `${feature} is a ${label} feature` : `Upgrade to ${label}`}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: 'var(--text-2)' }}>
        {description ?? `Unlock this and the rest of the ${label} toolkit to take your community to the next level.`}
      </p>
      <div className="mt-6 flex justify-center">
        <Link
          href={href}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all"
          style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 12px 30px -10px var(--p-glow)' }}
        >
          <Sparkles size={15} /> Upgrade to {label}
        </Link>
      </div>
    </div>
  )
}

/**
 * Wrapper that conditionally swaps its children for an upgrade prompt when
 * the user's plan doesn't meet the threshold. Usage:
 *
 *   <PlanGate requiredPlan="pro" feature="AI moderation">
 *     <PulseGuardSettings />
 *   </PlanGate>
 *
 * Lifts the "if/else around premium UI" pattern that would otherwise repeat at
 * every feature. The boolean prop `currentPlanAtLeastRequired` is the gate so
 * the wrapper stays purely presentational (lets the caller decide how to read
 * the user's plan — usually `usePlan().atLeast(required)`).
 */
export function PlanGate({
  currentPlanAtLeastRequired,
  requiredPlan,
  feature,
  description,
  children,
}: {
  currentPlanAtLeastRequired: boolean
  requiredPlan: Plan
  feature?: string
  description?: string
  children: React.ReactNode
}) {
  if (currentPlanAtLeastRequired) return <>{children}</>
  return <UpgradePrompt requiredPlan={requiredPlan} feature={feature} description={description} />
}
