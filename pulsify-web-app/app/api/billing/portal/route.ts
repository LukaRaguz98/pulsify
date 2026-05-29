import { NextResponse } from 'next/server'
import { stripe, isStripeConfigured } from '@/lib/stripe'
import { getCurrentDiscordUser } from '@/lib/workspace-auth'
import { getSubscriptionRow } from '@/lib/billing-server'
import { isEarlyAccess } from '@/lib/billing'

/**
 * POST /api/billing/portal
 *
 * Mints a Stripe Customer Portal session for the signed-in user and returns
 * its URL. The portal lets the user manage their payment method, switch
 * billing cycle, cancel/reactivate, and download invoices — all inside
 * Stripe's hosted UI. Everything that mutates here ultimately routes back to
 * us via the webhook handler.
 */
export async function POST(req: Request) {
  // Billing management is off during early access (no subscriptions exist).
  if (isEarlyAccess()) {
    return NextResponse.json(
      { error: 'Billing is paused during early access — Pulsify is free for now.' },
      { status: 403 },
    )
  }

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

  const row = await getSubscriptionRow(actor.userId)
  if (!row) {
    // Free-tier users haven't opened checkout yet, so there's no Stripe
    // customer to give the portal a handle on — bounce them to /pricing.
    return NextResponse.json(
      { error: 'You don\'t have an active subscription to manage yet.' },
      { status: 400 },
    )
  }

  const origin = new URL(req.url).origin
  const session = await stripe().billingPortal.sessions.create({
    customer: row.stripe_customer_id,
    return_url: `${origin}/billing`,
  })

  return NextResponse.json({ url: session.url })
}
