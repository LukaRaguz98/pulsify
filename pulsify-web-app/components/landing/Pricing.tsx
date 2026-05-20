'use client'

import { useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { PLANS, type Plan } from './landing-data'
import { SectionHeading } from './landing-ui'
import { EarlyAccessButton } from './LandingCtas'

type Billing = 'monthly' | 'yearly'
type Currency = 'usd' | 'eur'

const CURRENCY_SYMBOL: Record<Currency, string> = { usd: '$', eur: '€' }

// Plan prices are authored in USD; EUR is converted at a fixed approximate
// rate (no live FX on a marketing page) and rounded to a whole unit.
const FX_RATE: Record<Currency, number> = { usd: 1, eur: 0.92 }

function priceLabel(plan: Plan, billing: Billing, currency: Currency): { value: string; suffix: string } {
  const base = billing === 'monthly' ? plan.monthly : plan.yearly
  if (base === null) return { value: 'Custom', suffix: '' }
  const symbol = CURRENCY_SYMBOL[currency]
  if (base === 0) return { value: `${symbol}0`, suffix: 'forever' }
  const amount = Math.round(base * FX_RATE[currency])
  return { value: `${symbol}${amount}`, suffix: '/ mo' }
}

export function Pricing() {
  const [billing, setBilling] = useState<Billing>('yearly')
  const [currency, setCurrency] = useState<Currency>('usd')

  return (
    <section id="pricing" className="lp-anchor mx-auto max-w-7xl px-6 py-16">
      <SectionHeading
        eyebrow="Pricing"
        title="Simple pricing that scales with you"
        subtitle="Start free, upgrade when you grow. Every plan includes the Pulse bot and the full dashboard."
      />

      {/* Controls — billing period + currency, side by side. */}
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
        <div
          className="inline-flex items-center gap-1 rounded-full border p-1"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          {(['monthly', 'yearly'] as Billing[]).map((b) => {
            const active = billing === b
            return (
              <button
                key={b}
                type="button"
                onClick={() => setBilling(b)}
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

        {/* Currency toggle */}
        <div
          className="inline-flex items-center gap-1 rounded-full border p-1"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          {(['usd', 'eur'] as Currency[]).map((c) => {
            const active = currency === c
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCurrency(c)}
                aria-pressed={active}
                aria-label={c === 'usd' ? 'Show prices in US dollars' : 'Show prices in euros'}
                className="flex h-7 w-9 items-center justify-center rounded-full text-sm font-semibold transition-colors"
                style={{
                  background: active ? 'var(--p-1)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-2)',
                }}
              >
                {CURRENCY_SYMBOL[c]}
              </button>
            )
          })}
        </div>
      </div>

      {/* Plans — items stretch so every card is the same height; the fixed
          tagline + billed-note rows keep price, CTA and features aligned. */}
      <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-4">
        {PLANS.map((plan) => {
          const { value, suffix } = priceLabel(plan, billing, currency)
          const recommended = plan.recommended
          const showBilled = plan.yearly !== null && plan.yearly > 0 && billing === 'yearly'
          return (
            <div
              key={plan.name}
              className="lp-card relative flex h-full flex-col rounded-2xl border p-6"
              style={{
                background: recommended ? 'var(--panel-2)' : 'var(--panel)',
                borderColor: recommended ? 'var(--p-1)' : 'var(--line-strong)',
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

              <div className="flex items-center gap-2">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
                >
                  <plan.icon size={17} />
                </div>
                <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
              </div>

              {/* Fixed 2-line height keeps the price row aligned across cards. */}
              <p className="mt-3 min-h-[2.5rem] text-sm" style={{ color: 'var(--text-3)' }}>
                {plan.tagline}
              </p>

              <div className="mt-5 flex items-end gap-1.5">
                <span className="text-4xl font-bold tracking-tight text-foreground">{value}</span>
                {suffix && (
                  <span className="pb-1.5 text-sm" style={{ color: 'var(--text-3)' }}>
                    {suffix}
                  </span>
                )}
              </div>
              {/* Always reserve the note line so the CTA aligns across cards. */}
              <p className="mt-1 min-h-[1rem] text-xs" style={{ color: 'var(--text-3)' }}>
                {showBilled ? 'Billed annually' : ''}
              </p>

              <div className="mt-6">
                {plan.name === 'Free' ? (
                  <EarlyAccessButton variant="primary" size="md" full label="Start free" />
                ) : plan.name === 'Enterprise' ? (
                  <a
                    href="mailto:hello@pulsify.app?subject=Pulsify%20Enterprise"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all"
                    style={{ background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line-strong)' }}
                  >
                    {plan.cta}
                  </a>
                ) : (
                  <EarlyAccessButton variant={recommended ? 'primary' : 'secondary'} size="md" full label={plan.cta} />
                )}
              </div>

              <ul className="mt-6 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--text-2)' }}>
                    <span
                      className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                      style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
                    >
                      <Check size={11} />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      <p className="mt-8 text-center text-sm" style={{ color: 'var(--text-3)' }}>
        All plans include the Pulse bot, the full dashboard and free updates. Cancel any time.
        {currency === 'eur' && ' EUR prices are converted from USD at an approximate rate.'}
      </p>
    </section>
  )
}
