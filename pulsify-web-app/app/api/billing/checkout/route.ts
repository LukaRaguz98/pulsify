import { NextResponse } from 'next/server'
import { stripe, priceIdFor, isStripeConfigured } from '@/lib/stripe'
import { getCurrentDiscordUser } from '@/lib/workspace-auth'
import { getSubscriptionRow } from '@/lib/billing-server'
import { PLANS, BILLABLE_PLANS, type BillingCycle, type Plan } from '@/lib/billing'

/**
 * POST /api/billing/checkout
 *
 * Body: { plan: 'pro'|'business', cycle: 'monthly'|'yearly', trial?: boolean }
 *
 * Creates (or reuses) the user's Stripe customer, then mints a Stripe
 * Checkout session and returns its hosted URL. Free + Enterprise plans are
 * not self-serve here (Free has nothing to charge for; Enterprise routes to
 * a contact-sales mailto on the landing page).
 *
 * Uses Stripe Checkout's hosted page rather than embedded — keeps PCI scope
 * with Stripe and lets us inherit their UI for card / Apple Pay / etc.
 */
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: 'Billing is not configured for this environment.' },
      { status: 503 },
    )
  }

  const actor = await getCurrentDiscordUser()
  if (!actor) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }

  let body: { plan?: string; cycle?: string; trial?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const plan = body.plan as Plan
  const cycle = body.cycle as BillingCycle
  if (!(PLANS as readonly string[]).includes(plan) || !BILLABLE_PLANS.includes(plan)) {
    return NextResponse.json({ error: 'Plan is not available for checkout.' }, { status: 400 })
  }
  if (cycle !== 'monthly' && cycle !== 'yearly') {
    return NextResponse.json({ error: 'Invalid billing cycle.' }, { status: 400 })
  }

  const priceId = priceIdFor(plan, cycle)
  if (!priceId) {
    return NextResponse.json(
      { error: `No Stripe price configured for ${plan} ${cycle}.` },
      { status: 500 },
    )
  }

  const existing = await getSubscriptionRow(actor.userId)
  const sdk = stripe()

  // Reuse the existing Stripe customer for repeat purchases so card metadata,
  // billing address and invoices all stay on a single record. Only create a
  // new one the first time the user opens checkout.
  let customerId = existing?.stripe_customer_id
  if (!customerId) {
    const customer = await sdk.customers.create({
      // Discord user id — the durable identifier we key on. Stripe metadata is
      // arbitrary but the webhook handler looks for this exact key.
      metadata: { pulsify_user_id: actor.userId },
      name: actor.username ?? undefined,
    })
    customerId = customer.id
  }

  const origin = new URL(req.url).origin
  const session = await sdk.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing?status=cancelled`,
    // Trial windows ship with the price metadata in Stripe; we also accept a
    // body flag so we can offer a one-off "try Pro for 7 days" promo without
    // editing the price. 7 days is the platform-wide default.
    subscription_data: body.trial
      ? { trial_period_days: 7 }
      : undefined,
    // Allow promo codes — Pulsify campaigns issue them via the Stripe dashboard.
    allow_promotion_codes: true,
    metadata: {
      pulsify_user_id: actor.userId,
      pulsify_plan: plan,
      pulsify_cycle: cycle,
    },
  })

  if (!session.url) {
    return NextResponse.json({ error: 'Stripe did not return a checkout URL.' }, { status: 502 })
  }
  return NextResponse.json({ url: session.url })
}
