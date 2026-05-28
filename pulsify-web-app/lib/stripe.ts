import 'server-only'
import Stripe from 'stripe'

/**
 * Stripe SDK wrapper (PULSIFY-29).
 *
 * Single shared client + helpers for pricing lookup. NEVER import this file
 * from a client component — the secret key is server-only. Public-facing
 * configuration (plan slugs, feature limits) lives in `lib/billing.ts`.
 *
 * We lazily construct the client so missing env vars surface a clear error
 * at call time instead of crashing every page render during local dev where
 * billing is unused.
 */

let cachedClient: Stripe | null = null

export function stripe(): Stripe {
  if (cachedClient) return cachedClient
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set — billing endpoints cannot be used. ' +
      'Set it in your environment (see .env.example) or skip touching billing.',
    )
  }
  // Pinning the API version keeps payloads stable across SDK upgrades — Stripe
  // ships breaking changes per version and only the pinned one is used here.
  cachedClient = new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
  return cachedClient
}

/** Webhook signing secret. Throws when missing (the webhook would 500 anyway). */
export function stripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set.')
  return secret
}

/**
 * Server-side Stripe price-id lookup. Mirrors the client-side helper in
 * lib/billing.ts but reads the SERVER env vars (no NEXT_PUBLIC_) so price
 * ids never leak to bundles. Falls back to the public var if only that's set.
 */
import type { Plan, BillingCycle } from '@/lib/billing'

export function priceIdFor(plan: Plan, cycle: BillingCycle): string | null {
  if (plan === 'free' || plan === 'enterprise') return null
  const upperPlan = plan.toUpperCase()
  const upperCycle = cycle.toUpperCase()
  const serverKey = `STRIPE_PRICE_${upperPlan}_${upperCycle}`
  const publicKey = `NEXT_PUBLIC_STRIPE_PRICE_${upperPlan}_${upperCycle}`
  return process.env[serverKey] ?? process.env[publicKey] ?? null
}

/** True if Stripe is fully configured for the current environment. */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET
}
