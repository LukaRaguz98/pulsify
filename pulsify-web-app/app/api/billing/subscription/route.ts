import { NextResponse } from 'next/server'
import { getCurrentDiscordUser } from '@/lib/workspace-auth'
import {
  getSubscriptionRow,
  toClientSubscription,
  listSubscriptionEvents,
} from '@/lib/billing-server'
import { effectivePlan, isEarlyAccess, EARLY_ACCESS_PLAN } from '@/lib/billing'

/**
 * GET /api/billing/subscription
 *
 * Returns the trimmed subscription record for the signed-in user + their
 * effective plan + recent billing events. Used by the /billing page and any
 * client component that wants to render plan-aware UI without a server
 * roundtrip on every interaction.
 */
export async function GET() {
  const actor = await getCurrentDiscordUser()
  if (!actor) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }

  const row = await getSubscriptionRow(actor.userId)
  const subscription = toClientSubscription(row)
  const plan = isEarlyAccess() ? EARLY_ACCESS_PLAN : effectivePlan(row?.plan, row?.status)
  const events = row ? await listSubscriptionEvents(actor.userId, 20) : []

  return NextResponse.json({ subscription, plan, events })
}
