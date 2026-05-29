'use client'

import { createContext, useContext, type ReactNode } from 'react'
import {
  PLAN_LIMITS,
  hasPlan,
  type Plan,
  type FeatureLimits,
  type ClientSubscription,
} from '@/lib/billing'

/**
 * Client-side plan context (PULSIFY-29).
 *
 * Top-level layouts SSR the user's effective plan (server-side, via
 * lib/billing-server.getCurrentUserPlan) and pass it through this provider so
 * every client component below can render plan-aware UI WITHOUT a network
 * round-trip. The provider is read-only — actual plan changes happen through
 * the Stripe portal, and the dashboard re-renders on the next navigation
 * (or via the realtime subscription on /billing).
 *
 * SECURITY: this is a UI affordance only. Every premium feature server route
 * MUST still call lib/billing-server.requirePlan / requireFeature — never
 * trust the client to enforce the plan.
 */

type PlanContext = {
  plan: Plan
  limits: FeatureLimits
  subscription: ClientSubscription | null
  /** True while the everything-free early-access flag is on (see lib/billing). */
  earlyAccess: boolean
  /** `hasPlan(plan, required)` — convenience curried here so callers stay one-liner. */
  atLeast: (required: Plan) => boolean
  /** Boolean-or-positive-limit check on the limits matrix. */
  has: (feature: keyof FeatureLimits) => boolean
}

const Ctx = createContext<PlanContext | null>(null)

export function PlanProvider({
  plan,
  subscription,
  earlyAccess = false,
  children,
}: {
  plan: Plan
  subscription: ClientSubscription | null
  earlyAccess?: boolean
  children: ReactNode
}) {
  const limits = PLAN_LIMITS[plan]
  const value: PlanContext = {
    plan,
    limits,
    subscription,
    earlyAccess,
    // Early access unlocks everything regardless of the resolved plan — the
    // layout already feeds the top tier, but gate defensively here too.
    atLeast: (required) => earlyAccess || hasPlan(plan, required),
    has: (feature) => {
      if (earlyAccess) return true
      const v = limits[feature]
      return typeof v === 'boolean' ? v : v > 0
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Returns the current plan context, or a safe `free`-tier default when
 * called from a tree without a PlanProvider (e.g. public pages). */
export function usePlan(): PlanContext {
  const ctx = useContext(Ctx)
  if (ctx) return ctx
  // Public-page fallback — free + null subscription. Lets components like
  // UpgradePrompt be safely rendered from any tree.
  const limits = PLAN_LIMITS.free
  return {
    plan: 'free',
    limits,
    subscription: null,
    earlyAccess: false,
    atLeast: (required) => hasPlan('free', required),
    has: (feature) => {
      const v = limits[feature]
      return typeof v === 'boolean' ? v : v > 0
    },
  }
}
