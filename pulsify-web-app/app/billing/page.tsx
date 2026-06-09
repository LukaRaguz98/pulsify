import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import {
  getSubscriptionRow,
  toClientSubscription,
  listSubscriptionEvents,
} from '@/lib/billing-server'
import { getCurrentDiscordUser } from '@/lib/workspace-auth'
import { effectivePlan, isEarlyAccess, EARLY_ACCESS_PLAN } from '@/lib/billing'
import { BillingOverview } from '@/components/billing/BillingOverview'
import { HelpTip } from '@/components/ui/help-tip'

export const metadata: Metadata = {
  title: 'Billing · Pulsify',
  description: 'Manage your Pulsify subscription, invoices and plan.',
}

// /billing — user-scoped subscription dashboard (PULSIFY-29).
// Mirrors /preferences and /workspace: a top-level signed-in route (the
// gate is in billing/layout.tsx) that's NOT tied to a single Discord
// server, since one subscription covers a user's entire account.
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const actor = await getCurrentDiscordUser()
  if (!actor) redirect('/')

  const row = await getSubscriptionRow(actor.userId)
  const subscription = toClientSubscription(row)
  const earlyAccess = isEarlyAccess()
  // Early access unlocks everything, so show the top-tier limits table.
  const plan = earlyAccess ? EARLY_ACCESS_PLAN : effectivePlan(row?.plan, row?.status)
  const events = row ? await listSubscriptionEvents(actor.userId, 20) : []

  const { status } = await searchParams
  const flash = status === 'success' ? 'success' : status === 'cancelled' ? 'cancelled' : null

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium"
        style={{ color: 'var(--text-3)' }}
      >
        <ArrowLeft size={14} /> Back to dashboard
      </Link>
      <header className="mb-8">
        <h1 className="flex items-center gap-1.5 text-3xl font-bold tracking-tight text-foreground">
          Billing &amp; subscription
          <HelpTip id="billing" iconSize={18} />
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: 'var(--text-2)' }}>
          Manage your plan, payment method and invoices. Billing changes sync automatically with your dashboard.
        </p>
      </header>

      <BillingOverview
        subscription={subscription}
        plan={plan}
        events={events}
        flash={flash}
        earlyAccess={earlyAccess}
      />
    </main>
  )
}
