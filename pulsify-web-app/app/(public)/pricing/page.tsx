import type { Metadata } from 'next'
import { Eyebrow } from '@/components/landing/landing-ui'
import { PricingCards } from '@/components/billing/PricingCards'
import { getCurrentClientSubscription } from '@/lib/billing-server'
import { effectivePlan } from '@/lib/billing'

export const metadata: Metadata = {
  title: 'Pricing · Pulsify',
  description:
    'Simple, transparent pricing for Pulsify — Free, Pro, Business and Enterprise plans with monthly or yearly billing.',
  alternates: { canonical: '/pricing' },
}

export default async function PricingPage() {
  const subscription = await getCurrentClientSubscription()
  const currentPlan = effectivePlan(subscription?.plan, subscription?.status)

  return (
    <div className="mx-auto max-w-6xl px-6 pb-14 pt-10 sm:pb-20 sm:pt-14">
      <header className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <Eyebrow>Pricing</Eyebrow>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Simple pricing that scales with you
        </h1>
        <p className="mt-5 text-base leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Start free, upgrade when you grow. Every plan includes the Pulse bot and the full dashboard.
        </p>
      </header>

      <PricingCards currentPlan={currentPlan} />
    </div>
  )
}
