import 'server-only'
import { createClient as createServerSupabase } from '@/lib/supabase-server'
import {
  PLANS,
  SUBSCRIPTION_STATUSES,
  effectivePlan,
  isEarlyAccess,
  EARLY_ACCESS_PLAN,
  type Plan,
  type SubscriptionStatus,
  type BillingCycle,
  type SubscriptionRow,
  type ClientSubscription,
  PLAN_RANK,
  PLAN_LIMITS,
  type FeatureLimits,
} from '@/lib/billing'
import { getCurrentDiscordUser } from '@/lib/workspace-auth'

/**
 * Server-only billing helpers (PULSIFY-29).
 *
 * The single source of truth for "what plan is this user on, and what may
 * they do". Reads `public.subscriptions`, normalises Stripe statuses into a
 * plan + active flag, and exposes a couple of convenience gates the rest of
 * the app can drop into route handlers / server actions.
 *
 * Browser-facing UI gets the trimmed `ClientSubscription` shape via
 * `getCurrentClientSubscription` — no Stripe ids ever cross the wire.
 */

/**
 * Read the raw subscription row for a Discord user id. Returns null when the
 * user has never subscribed (free tier by default).
 */
export async function getSubscriptionRow(userId: string): Promise<SubscriptionRow | null> {
  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle<SubscriptionRow>()
  if (!data) return null
  // Defensive normalisation: if a webhook ever wrote a bogus plan/status the
  // app would crash on the typed comparison. Coerce unknown values to safe
  // defaults so the user just falls back to free instead of seeing an error.
  const plan = (PLANS as readonly string[]).includes(data.plan) ? data.plan : 'free'
  const status = (SUBSCRIPTION_STATUSES as readonly string[]).includes(data.status)
    ? data.status
    : 'canceled'
  return { ...data, plan: plan as Plan, status: status as SubscriptionStatus }
}

/** Resolve the effective plan for a user id (treats demoted statuses as free). */
export async function getUserPlan(userId: string): Promise<Plan> {
  // Early access: everyone is treated as the top tier, so every downstream gate
  // (requirePlan / requireFeature / getCurrentUserLimits / page-level checks)
  // passes and all limits read as unlimited — no per-call special-casing needed.
  // Flip EARLY_ACCESS off and this returns to the real subscription plan.
  if (isEarlyAccess()) return EARLY_ACCESS_PLAN
  const row = await getSubscriptionRow(userId)
  return effectivePlan(row?.plan, row?.status)
}

/** Resolve the effective plan for the *current* signed-in user (or 'free'). */
export async function getCurrentUserPlan(): Promise<Plan> {
  const actor = await getCurrentDiscordUser()
  if (!actor) return 'free'
  return getUserPlan(actor.userId)
}

/** Feature-limit matrix for the current effective plan. */
export async function getCurrentUserLimits(): Promise<FeatureLimits> {
  const plan = await getCurrentUserPlan()
  return PLAN_LIMITS[plan]
}

/**
 * Trim a subscription row down to what's safe to send to the browser. We
 * include `plan` and `status` so the UI can render the badge + renewal info,
 * but explicitly strip the Stripe ids (the customer/sub ids belong only on
 * the server, where the portal/checkout endpoints look them up).
 */
export function toClientSubscription(row: SubscriptionRow | null): ClientSubscription | null {
  if (!row) return null
  return {
    plan: row.plan,
    status: row.status,
    billing_cycle: row.billing_cycle,
    renewal_date: row.renewal_date,
    cancel_at_period_end: row.cancel_at_period_end,
    trial_ends_at: row.trial_ends_at,
  }
}

/** Convenience: get the trimmed subscription for the signed-in user. */
export async function getCurrentClientSubscription(): Promise<ClientSubscription | null> {
  const actor = await getCurrentDiscordUser()
  if (!actor) return null
  const row = await getSubscriptionRow(actor.userId)
  return toClientSubscription(row)
}

// ── Gates ────────────────────────────────────────────────────────────────
// These return a plain Result rather than throwing so callers can choose
// their own response shape (JSON for API routes, redirect for server pages,
// inline error for actions). Mirrors the lib/workspace-auth result style.

export type PlanGateResult =
  | { ok: true; plan: Plan; userId: string }
  | { ok: false; error: string; required: Plan; current: Plan }

export async function requirePlan(required: Plan): Promise<PlanGateResult> {
  const actor = await getCurrentDiscordUser()
  if (!actor) {
    return { ok: false, error: 'You must be signed in.', required, current: 'free' }
  }
  const current = await getUserPlan(actor.userId)
  if (PLAN_RANK[current] < PLAN_RANK[required]) {
    return {
      ok: false,
      error: `That feature requires the ${required} plan.`,
      required,
      current,
    }
  }
  return { ok: true, plan: current, userId: actor.userId }
}

export type FeatureGateResult =
  | { ok: true; plan: Plan; userId: string; limits: FeatureLimits }
  | { ok: false; error: string; current: Plan }

/**
 * Boolean-feature gate: checks a flag in the limits matrix (aiModeration,
 * customBranding, …). Lets a handler short-circuit with a 403 + clear error.
 */
export async function requireFeature(
  feature: keyof FeatureLimits,
): Promise<FeatureGateResult> {
  const actor = await getCurrentDiscordUser()
  if (!actor) {
    return { ok: false, error: 'You must be signed in.', current: 'free' }
  }
  const current = await getUserPlan(actor.userId)
  const limits = PLAN_LIMITS[current]
  const value = limits[feature]
  // Boolean limits gate via truthiness; numeric limits gate via "> 0" (zero
  // means the feature is disabled at this tier).
  const allowed = typeof value === 'boolean' ? value : value > 0
  if (!allowed) {
    return {
      ok: false,
      error: `Your plan doesn't include "${feature}". Upgrade to unlock it.`,
      current,
    }
  }
  return { ok: true, plan: current, userId: actor.userId, limits }
}

// ── Webhook → DB sync ────────────────────────────────────────────────────

/**
 * Upsert the subscription row for a Discord user. Called by the webhook
 * handler after every billing event; merges the patch into whatever's there
 * (or inserts a fresh row). `created_at` is preserved on update.
 */
export async function upsertSubscription(patch: {
  userId: string
  stripeCustomerId: string
  stripeSubscriptionId?: string | null
  plan?: Plan
  status?: SubscriptionStatus
  billingCycle?: BillingCycle
  renewalDate?: string | null
  cancelAtPeriodEnd?: boolean
  trialEndsAt?: string | null
}): Promise<void> {
  const supabase = await createServerSupabase()
  const row: Partial<SubscriptionRow> & { user_id: string; stripe_customer_id: string } = {
    user_id: patch.userId,
    stripe_customer_id: patch.stripeCustomerId,
    updated_at: new Date().toISOString(),
  }
  if (patch.stripeSubscriptionId !== undefined) row.stripe_subscription_id = patch.stripeSubscriptionId
  if (patch.plan !== undefined) row.plan = patch.plan
  if (patch.status !== undefined) row.status = patch.status
  if (patch.billingCycle !== undefined) row.billing_cycle = patch.billingCycle
  if (patch.renewalDate !== undefined) row.renewal_date = patch.renewalDate
  if (patch.cancelAtPeriodEnd !== undefined) row.cancel_at_period_end = patch.cancelAtPeriodEnd
  if (patch.trialEndsAt !== undefined) row.trial_ends_at = patch.trialEndsAt

  await supabase.from('subscriptions').upsert(row, { onConflict: 'user_id' })
}

/**
 * Append a billing event to the audit log. `event_id` is the Stripe event id
 * and is unique; the unique constraint makes replays a no-op (Stripe retries
 * webhooks on 5xx — we want at-most-once side effects).
 */
export async function recordSubscriptionEvent(event: {
  userId: string | null
  eventId: string
  eventType: string
  plan?: Plan | null
  status?: SubscriptionStatus | null
  amountCents?: number | null
  currency?: string | null
  invoiceUrl?: string | null
  payload: unknown
}): Promise<void> {
  const supabase = await createServerSupabase()
  // ON CONFLICT DO NOTHING via Supabase: upsert with ignoreDuplicates.
  await supabase
    .from('subscription_events')
    .upsert(
      {
        user_id: event.userId,
        event_id: event.eventId,
        event_type: event.eventType,
        plan: event.plan ?? null,
        status: event.status ?? null,
        amount_cents: event.amountCents ?? null,
        currency: event.currency ?? null,
        invoice_url: event.invoiceUrl ?? null,
        payload: event.payload,
      },
      { onConflict: 'event_id', ignoreDuplicates: true },
    )
}

/** List the most recent billing events for a user (newest first). */
export async function listSubscriptionEvents(userId: string, limit = 20) {
  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('subscription_events')
    .select('id, event_type, plan, status, amount_cents, currency, invoice_url, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return data ?? []
}
