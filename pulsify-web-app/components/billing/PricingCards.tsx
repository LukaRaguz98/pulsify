'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import {
  PLANS,
  PLAN_LABELS,
  PLAN_TAGLINES,
  PLAN_PRICES,
  PLAN_FEATURES,
  PLAN_CTA,
  PLAN_RECOMMENDED,
  BILLABLE_PLANS,
  type Plan,
  type BillingCycle,
} from '@/lib/billing'

/**
 * Pricing cards + cycle toggle, shared by the public /pricing page, the
 * landing-page Pricing section and the in-dashboard upgrade modal. Single
 * source of truth — when sales changes a tagline or a feature bullet, every
 * surface updates from `lib/billing.ts`.
 *
 * `currentPlan` highlights the user's active tier (cards then show "Current
 * plan" instead of "Upgrade"). `onCheckout` is a hook for the dashboard
 * variant that opens an in-app confirmation modal first; the default shells
 * out to /api/billing/checkout directly so the landing page can reuse it.
 */

// Prices are USD-only. The previous EUR toggle was removed — every surface
// quotes a single currency so checkout (always USD in Stripe) matches what the
// user sees.
export function PricingCards({
  currentPlan,
  initialCycle = 'yearly',
  enterpriseContactEmail = 'hello@pulsify.app',
  earlyAccess = false,
}: {
  currentPlan?: Plan
  initialCycle?: BillingCycle
  enterpriseContactEmail?: string
  /** While true, every plan is free: checkout is replaced by a "start free" CTA
   * and a banner explains the early-access state (see lib/billing.isEarlyAccess). */
  earlyAccess?: boolean
}) {
  const router = useRouter()
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle)
  const [loading, setLoading] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Kick off Discord OAuth and return the user straight back to checkout for
  // this plan once authenticated. The `?checkout=` param on the resume URL is
  // picked up by the effect below when /pricing reloads after the callback.
  async function signInThenCheckout(plan: Plan, forCycle: BillingCycle) {
    const supabase = createClient()
    const resume = `/pricing?checkout=${plan}&cycle=${forCycle}`
    await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(resume)}`,
        scopes: 'identify email guilds',
        queryParams: { prompt: 'consent' },
      },
    })
  }

  async function startCheckout(plan: Plan, overrideCycle?: BillingCycle) {
    const forCycle = overrideCycle ?? cycle
    setLoading(plan)
    setError(null)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, cycle: forCycle }),
      })
      const data: { url?: string; error?: string } = await res.json()
      if (!res.ok || !data.url) {
        // 401 means "log in first" — send the user through Discord sign-in and
        // resume this exact checkout the moment they return, so a not-yet-logged-in
        // visitor still lands on Stripe instead of a dead button.
        if (res.status === 401) {
          await signInThenCheckout(plan, forCycle)
          return
        }
        setError(data.error ?? 'Could not start checkout. Try again in a moment.')
        return
      }
      window.location.href = data.url
    } catch {
      setError('Network error — check your connection and retry.')
    } finally {
      setLoading(null)
    }
  }

  // After the sign-in bounce, /pricing reloads with `?checkout=<plan>`. Pick the
  // plan back up and head straight to Stripe so the user doesn't have to click
  // Upgrade a second time. Reads location directly (not useSearchParams) to keep
  // the statically-rendered landing page from needing a Suspense boundary.
  useEffect(() => {
    // No checkout to resume while billing is off.
    if (earlyAccess) return
    const params = new URLSearchParams(window.location.search)
    const requested = params.get('checkout')
    if (!requested || !BILLABLE_PLANS.includes(requested as Plan)) return
    const rawCycle = params.get('cycle')
    const resumeCycle: BillingCycle = rawCycle === 'monthly' || rawCycle === 'yearly' ? rawCycle : cycle
    // Defer past the effect body so the resume doesn't fire setState
    // synchronously during commit.
    const id = setTimeout(() => { void startCheckout(requested as Plan, resumeCycle) }, 0)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      {earlyAccess && (
        <div
          className="mx-auto mb-8 flex max-w-2xl items-center justify-center gap-2 rounded-xl border px-4 py-3 text-center text-sm font-medium"
          style={{ background: 'var(--p-soft)', borderColor: 'color-mix(in srgb, var(--p-1) 35%, transparent)', color: 'var(--p-1)' }}
        >
          <Sparkles size={15} className="shrink-0" />
          Pulsify is free during early access — every plan below is unlocked at no cost. Prices apply once early access ends.
        </div>
      )}

      {/* Controls — billing period toggle (USD-only, no currency switch). */}
      <div className="mt-2 flex items-center justify-center">
        <div
          className="inline-flex items-center gap-1 rounded-full border p-1"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          {(['monthly', 'yearly'] as BillingCycle[]).map((b) => {
            const active = cycle === b
            return (
              <button
                key={b}
                type="button"
                onClick={() => setCycle(b)}
                className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
                style={{
                  background: active ? 'var(--p-1)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-2)',
                }}
              >
                {b === 'monthly' ? 'Monthly' : 'Yearly'}
                {b === 'yearly' && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                    style={{
                      background: active ? 'rgba(255,255,255,0.22)' : 'var(--p-soft)',
                      color: active ? '#fff' : 'var(--p-1)',
                    }}
                  >
                    -20%
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <div
          className="mx-auto mt-6 max-w-md rounded-lg border px-4 py-3 text-center text-sm"
          style={{ background: 'rgba(239,68,68,0.07)', borderColor: 'rgba(239,68,68,0.25)', color: 'rgb(239,68,68)' }}
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-4">
        {PLANS.map((plan) => {
          const price = PLAN_PRICES[plan]
          const base = cycle === 'monthly' ? price.monthly : price.yearly
          const isCurrent = currentPlan === plan
          const recommended = plan === PLAN_RECOMMENDED && !isCurrent
          const showBilled = price.yearly !== null && price.yearly > 0 && cycle === 'yearly'

          const valueLabel = base === null
            ? 'Custom'
            : base === 0
              ? '$0'
              : `$${base}`
          const suffix = base === null ? '' : base === 0 ? 'forever' : '/ mo'

          const cta = isCurrent
            ? 'Current plan'
            : PLAN_CTA[plan]
          const ctaDisabled = isCurrent || loading !== null

          return (
            <div
              key={plan}
              className="lp-card relative flex h-full flex-col rounded-2xl border p-6"
              style={{
                background: recommended ? 'var(--panel-2)' : 'var(--panel)',
                borderColor: recommended ? 'var(--p-1)' : isCurrent ? 'var(--p-1)' : 'var(--line-strong)',
                boxShadow: recommended ? '0 24px 60px -28px var(--p-glow)' : undefined,
              }}
            >
              {recommended && (
                <span
                  className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold text-white"
                  style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
                >
                  <Sparkles size={11} /> Most popular
                </span>
              )}
              {isCurrent && (
                <span
                  className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-bold"
                  style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
                >
                  Current plan
                </span>
              )}

              <h3 className="text-lg font-bold text-foreground">{PLAN_LABELS[plan]}</h3>
              <p className="mt-3 min-h-[2.5rem] text-sm" style={{ color: 'var(--text-3)' }}>
                {PLAN_TAGLINES[plan]}
              </p>

              <div className="mt-5 flex items-end gap-1.5">
                <span className="text-4xl font-bold tracking-tight text-foreground">{valueLabel}</span>
                {suffix && (
                  <span className="pb-1.5 text-sm" style={{ color: 'var(--text-3)' }}>
                    {suffix}
                  </span>
                )}
              </div>
              <p className="mt-1 min-h-[1rem] text-xs" style={{ color: 'var(--text-3)' }}>
                {showBilled ? 'Billed annually' : ''}
              </p>

              <div className="mt-6">
                {earlyAccess && plan !== 'enterprise' ? (
                  // Billing is off — every tier is free, so the CTA just sends
                  // the user into the dashboard instead of Stripe checkout.
                  <button
                    type="button"
                    disabled={isCurrent}
                    onClick={() => router.push('/dashboard')}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all"
                    style={{
                      background: recommended ? 'linear-gradient(180deg, var(--p-1), var(--p-2))' : 'var(--p-soft)',
                      color: recommended ? '#fff' : 'var(--p-1)',
                      border: recommended ? 'none' : '1px solid color-mix(in srgb, var(--p-1) 35%, transparent)',
                      opacity: isCurrent ? 0.7 : 1,
                      cursor: isCurrent ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isCurrent ? 'Current plan' : 'Free in early access'}
                  </button>
                ) : plan === 'enterprise' ? (
                  <a
                    href={`mailto:${enterpriseContactEmail}?subject=Pulsify%20Enterprise`}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all"
                    style={{ background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line-strong)' }}
                  >
                    {earlyAccess ? 'Contact sales' : cta}
                  </a>
                ) : plan === 'free' ? (
                  <button
                    type="button"
                    disabled={ctaDisabled}
                    onClick={() => router.push('/dashboard')}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all"
                    style={{
                      background: 'var(--panel)',
                      color: 'var(--text)',
                      border: '1px solid var(--line-strong)',
                      opacity: ctaDisabled ? 0.6 : 1,
                      cursor: ctaDisabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {cta}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={ctaDisabled || !BILLABLE_PLANS.includes(plan)}
                    onClick={() => startCheckout(plan)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all"
                    style={{
                      background: recommended ? 'linear-gradient(180deg, var(--p-1), var(--p-2))' : 'var(--p-soft)',
                      color: recommended ? '#fff' : 'var(--p-1)',
                      border: recommended ? 'none' : '1px solid color-mix(in srgb, var(--p-1) 35%, transparent)',
                      opacity: ctaDisabled ? 0.7 : 1,
                      cursor: ctaDisabled ? 'progress' : 'pointer',
                    }}
                  >
                    {loading === plan ? 'Redirecting…' : cta}
                  </button>
                )}
              </div>

              <ul className="mt-6 space-y-2.5">
                {PLAN_FEATURES[plan].map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--text-2)' }}>
                    <span
                      className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                      style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
                    >
                      <Check size={11} />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      <p className="mt-8 text-center text-sm" style={{ color: 'var(--text-3)' }}>
        All plans include the Pulse bot, the full dashboard and free updates. Cancel any time. Prices in USD.
      </p>
    </div>
  )
}
