import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe, stripeWebhookSecret, isStripeConfigured } from '@/lib/stripe'
import { upsertSubscription, recordSubscriptionEvent } from '@/lib/billing-server'
import { PLANS, SUBSCRIPTION_STATUSES, type Plan, type SubscriptionStatus, type BillingCycle } from '@/lib/billing'

/**
 * POST /api/billing/webhook
 *
 * Stripe webhook handler — the ONLY source of truth that mutates
 * public.subscriptions. We verify the signature (so a forged request can't
 * promote a user to Enterprise), then route on event type:
 *
 *  checkout.session.completed       → user finished checkout for the first time;
 *                                     subscription is now active.
 *  customer.subscription.updated    → plan / status / cycle / cancel-at-period-end
 *                                     changed (portal-driven upgrade, downgrade,
 *                                     cycle switch, scheduled cancellation, ...).
 *  customer.subscription.deleted    → subscription ended fully (post period or
 *                                     after a failed payment retry window). Demote.
 *  invoice.payment_succeeded        → recurring payment cleared — log it (audit /
 *                                     history) and refresh renewal_date.
 *  invoice.payment_failed           → flag the row past_due so the dashboard can
 *                                     show a banner; Stripe's smart retries take
 *                                     it from here.
 *
 * Replays: every event is uniquely identified by `event.id`; the
 * subscription_events table dedupes on it, so a Stripe retry after our 500 is
 * harmless.
 */
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Billing not configured.' }, { status: 503 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 })
  }

  // Stripe verifies against the RAW body bytes — Next's req.text() preserves
  // them, whereas req.json() reformats and would break the signature check.
  const rawBody = await req.text()
  const sdk = stripe()

  let event: Stripe.Event
  try {
    event = sdk.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown verification error.'
    return NextResponse.json({ error: `Invalid signature: ${message}` }, { status: 400 })
  }

  try {
    await handleEvent(event, sdk)
    return NextResponse.json({ received: true })
  } catch (err) {
    // Returning 500 makes Stripe retry the delivery (built-in exponential
    // backoff over ~3 days). The unique constraint on event_id keeps the
    // eventual successful handler idempotent.
    console.error('[billing] webhook handler failed', event.type, err)
    return NextResponse.json({ error: 'Webhook handler error.' }, { status: 500 })
  }
}

async function handleEvent(event: Stripe.Event, sdk: Stripe): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.metadata?.pulsify_user_id
      const customerId = typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id
      const subscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id
      if (!userId || !customerId || !subscriptionId) {
        // Missing identifiers — log and bail rather than guessing. Stripe will
        // retry, but the metadata won't reappear, so the eventual no-op is fine.
        await recordSubscriptionEvent({
          userId: userId ?? null,
          eventId: event.id,
          eventType: event.type,
          payload: event,
        })
        return
      }
      const sub = await sdk.subscriptions.retrieve(subscriptionId)
      const snap = readSubscription(sub, session.metadata)
      await upsertSubscription({
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        ...snap,
      })
      await recordSubscriptionEvent({
        userId,
        eventId: event.id,
        eventType: event.type,
        plan: snap.plan ?? null,
        status: snap.status ?? null,
        payload: event,
      })
      return
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub = event.data.object as Stripe.Subscription
      const userId = await resolveUserId(sub, sdk)
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
      if (!userId) {
        await recordSubscriptionEvent({
          userId: null,
          eventId: event.id,
          eventType: event.type,
          payload: event,
        })
        return
      }
      const snap = readSubscription(sub)
      await upsertSubscription({
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        ...snap,
      })
      await recordSubscriptionEvent({
        userId,
        eventId: event.id,
        eventType: event.type,
        plan: snap.plan ?? null,
        status: snap.status ?? null,
        payload: event,
      })
      return
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const userId = await resolveUserId(sub, sdk)
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
      if (!userId) {
        await recordSubscriptionEvent({
          userId: null,
          eventId: event.id,
          eventType: event.type,
          payload: event,
        })
        return
      }
      // Demote to free + clear the active subscription id, but KEEP the row
      // so the customer id sticks around for the next checkout (and the
      // billing page can show "you used to be on Pro, resubscribe?").
      await upsertSubscription({
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: null,
        plan: 'free',
        status: 'canceled',
        cancelAtPeriodEnd: false,
        renewalDate: null,
        trialEndsAt: null,
      })
      await recordSubscriptionEvent({
        userId,
        eventId: event.id,
        eventType: event.type,
        plan: 'free',
        status: 'canceled',
        payload: event,
      })
      return
    }

    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
      const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
      let userId: string | null = null
      if (customerId) userId = await resolveUserIdFromCustomer(customerId, sdk)

      // payment_failed leaves the subscription in past_due (Stripe handles
      // retries); we only flip our local status, leaving plan untouched so
      // the dashboard can render a "fix payment" banner without revoking
      // access immediately.
      if (userId && customerId) {
        if (event.type === 'invoice.payment_failed') {
          await upsertSubscription({
            userId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subId ?? null,
            status: 'past_due',
          })
        } else if (subId) {
          // Successful payment — re-read the subscription so renewal_date and
          // status reflect the new period.
          const sub = await sdk.subscriptions.retrieve(subId)
          const snap = readSubscription(sub)
          await upsertSubscription({
            userId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subId,
            ...snap,
          })
        }
      }
      await recordSubscriptionEvent({
        userId,
        eventId: event.id,
        eventType: event.type,
        amountCents: invoice.amount_paid ?? invoice.amount_due ?? null,
        currency: invoice.currency ?? null,
        invoiceUrl: invoice.hosted_invoice_url ?? null,
        payload: event,
      })
      return
    }

    default:
      // Log unknown events for audit purposes but don't fail — Stripe sends
      // many event types we don't care about.
      await recordSubscriptionEvent({
        userId: null,
        eventId: event.id,
        eventType: event.type,
        payload: event,
      })
  }
}

// ── Snapshot helpers ─────────────────────────────────────────────────────

type SubscriptionSnapshot = {
  plan?: Plan
  status?: SubscriptionStatus
  billingCycle?: BillingCycle
  renewalDate?: string | null
  cancelAtPeriodEnd?: boolean
  trialEndsAt?: string | null
}

/**
 * Translate a Stripe Subscription into our row patch. Plan is inferred from
 * the metadata Pulsify attached at checkout (`pulsify_plan`), with a fallback
 * to the price-id lookup for changes initiated via the portal where our
 * metadata isn't attached.
 */
function readSubscription(
  sub: Stripe.Subscription,
  sessionMetadata?: Record<string, string> | null,
): SubscriptionSnapshot {
  const item = sub.items.data[0]
  const priceId = item?.price.id
  const interval = item?.price.recurring?.interval

  // Prefer metadata set by us; fall back to env-var price-id mapping; final
  // fallback inspects the Stripe nickname (e.g. "Pulsify Pro"). The default
  // 'pro' keeps the row valid if all three miss — better than crashing.
  const metaPlan = (sessionMetadata?.pulsify_plan ?? sub.metadata?.pulsify_plan) as Plan | undefined
  const plan: Plan = isPlan(metaPlan)
    ? metaPlan
    : (planFromPriceId(priceId) ?? planFromNickname(item?.price.nickname) ?? 'pro')

  const status: SubscriptionStatus = (SUBSCRIPTION_STATUSES as readonly string[]).includes(sub.status)
    ? (sub.status as SubscriptionStatus)
    : 'active'

  const cycle: BillingCycle = interval === 'year' ? 'yearly' : 'monthly'

  // `current_period_end` is a unix-seconds integer on the Stripe object; we
  // store it as ISO in Supabase for cleaner client formatting. The cast is
  // safe because Stripe always sets it on active subscriptions.
  // Use the per-item period when the top-level is missing (Stripe 2025 schema).
  const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end
    ?? item?.current_period_end
  const trialEnd = sub.trial_end ?? null

  return {
    plan,
    status,
    billingCycle: cycle,
    renewalDate: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    trialEndsAt: trialEnd ? new Date(trialEnd * 1000).toISOString() : null,
  }
}

function isPlan(value: unknown): value is Plan {
  return typeof value === 'string' && (PLANS as readonly string[]).includes(value)
}

/**
 * Cross-reference a Stripe price id with the env-var map (set at deploy time
 * by the operator). Returns null if the id isn't recognised — the metadata
 * path above is the primary route, this is the portal-driven fallback.
 */
function planFromPriceId(priceId?: string): Plan | null {
  if (!priceId) return null
  for (const plan of PLANS) {
    if (plan === 'free' || plan === 'enterprise') continue
    for (const cycle of ['monthly', 'yearly'] as const) {
      const env = process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${cycle.toUpperCase()}`]
        ?? process.env[`NEXT_PUBLIC_STRIPE_PRICE_${plan.toUpperCase()}_${cycle.toUpperCase()}`]
      if (env === priceId) return plan
    }
  }
  return null
}

/** Loose "the price's nickname contains the plan name" fallback. */
function planFromNickname(nickname?: string | null): Plan | null {
  if (!nickname) return null
  const lower = nickname.toLowerCase()
  for (const plan of PLANS) {
    if (plan === 'free') continue
    if (lower.includes(plan)) return plan
  }
  return null
}

/**
 * Resolve the Pulsify user id for a Stripe Subscription. Prefers metadata on
 * the subscription itself, falling back to the customer's metadata (set when
 * we created the customer in /api/billing/checkout).
 */
async function resolveUserId(sub: Stripe.Subscription, sdk: Stripe): Promise<string | null> {
  const meta = sub.metadata?.pulsify_user_id
  if (meta) return meta
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  return resolveUserIdFromCustomer(customerId, sdk)
}

async function resolveUserIdFromCustomer(customerId: string, sdk: Stripe): Promise<string | null> {
  try {
    const customer = await sdk.customers.retrieve(customerId)
    if ('deleted' in customer && customer.deleted) return null
    return customer.metadata?.pulsify_user_id ?? null
  } catch {
    return null
  }
}
