import { SectionHeading } from './landing-ui'
import { PricingCards } from '@/components/billing/PricingCards'
import { isEarlyAccess } from '@/lib/billing'

export function Pricing() {
  return (
    <section id="pricing" className="lp-anchor mx-auto max-w-7xl px-6 py-16">
      <SectionHeading
        eyebrow="Pricing"
        title="Simple pricing that scales with you"
        subtitle="Start free, upgrade when you grow. Every plan includes the Pulse bot and the full dashboard."
      />
      {/* PricingCards is shared with /pricing and the in-dashboard upgrade
          modal so plan metadata and the checkout flow stay identical
          everywhere. Cycle defaults to yearly to nudge the better deal. */}
      <PricingCards earlyAccess={isEarlyAccess()} />
    </section>
  )
}
