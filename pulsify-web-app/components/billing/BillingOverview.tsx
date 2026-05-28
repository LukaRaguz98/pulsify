'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Crown, ExternalLink, RotateCcw, XCircle, Receipt, AlertTriangle, CheckCircle2 } from 'lucide-react'
import {
  PLAN_LABELS,
  PLAN_LIMITS,
  formatLimit,
  type ClientSubscription,
  type Plan,
} from '@/lib/billing'

type EventRow = {
  id: string
  event_type: string
  plan: string | null
  status: string | null
  amount_cents: number | null
  currency: string | null
  invoice_url: string | null
  created_at: string
}

const STATUS_LABELS: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'info' }> = {
  active: { label: 'Active', tone: 'good' },
  trialing: { label: 'Trial', tone: 'info' },
  past_due: { label: 'Payment overdue', tone: 'warn' },
  canceled: { label: 'Canceled', tone: 'bad' },
  incomplete: { label: 'Incomplete', tone: 'warn' },
  incomplete_expired: { label: 'Expired', tone: 'bad' },
  unpaid: { label: 'Unpaid', tone: 'bad' },
  paused: { label: 'Paused', tone: 'warn' },
}

const TONE_STYLES = {
  good: { bg: 'rgba(52,211,153,0.12)', color: '#34d399', border: 'rgba(52,211,153,0.4)' },
  warn: { bg: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: 'rgba(251,191,36,0.4)' },
  bad:  { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444', border: 'rgba(239,68,68,0.4)' },
  info: { bg: 'var(--p-soft)',         color: 'var(--p-1)', border: 'color-mix(in srgb, var(--p-1) 35%, transparent)' },
} as const

/**
 * Billing dashboard content — the home for /billing.
 *
 * Renders three sections:
 *  1. Active plan card: plan badge, status, renewal date, primary action
 *     (Manage in Stripe portal), and cancel/reactivate hint.
 *  2. Plan limits: the user-facing version of the gating matrix from
 *     lib/billing.ts so the user can see what they get.
 *  3. Billing history: invoice rows from subscription_events.
 *
 * All mutations go through Stripe's Customer Portal (one click → Stripe UI).
 * Local actions like "browse plans" route to /pricing.
 */
export function BillingOverview({
  subscription,
  plan,
  events,
  flash,
}: {
  subscription: ClientSubscription | null
  plan: Plan
  events: EventRow[]
  flash?: 'success' | 'cancelled' | null
}) {
  const router = useRouter()
  const [openingPortal, setOpeningPortal] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)

  async function openPortal() {
    setOpeningPortal(true)
    setPortalError(null)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const data: { url?: string; error?: string } = await res.json()
      if (!res.ok || !data.url) {
        setPortalError(data.error ?? 'Could not open the billing portal. Try again in a moment.')
        return
      }
      window.location.href = data.url
    } catch {
      setPortalError('Network error — please retry.')
    } finally {
      setOpeningPortal(false)
    }
  }

  const status = subscription?.status ?? (plan === 'free' ? 'active' : 'canceled')
  const statusInfo = STATUS_LABELS[status] ?? { label: status, tone: 'info' as const }
  const statusStyle = TONE_STYLES[statusInfo.tone]

  const renewal = subscription?.renewal_date
    ? new Date(subscription.renewal_date).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null

  const limits = PLAN_LIMITS[plan]

  return (
    <div className="space-y-8">
      {/* Flash messages — checkout success / cancellation feedback from the
          URL query string. Animated in so it feels like a notification, not a
          static banner that's been there since page load. */}
      {flash === 'success' && (
        <FlashBanner tone="good" icon={<CheckCircle2 size={16} />}>
          Subscription activated — welcome to {PLAN_LABELS[plan]}. It can take a few seconds
          for everything to sync.
        </FlashBanner>
      )}
      {flash === 'cancelled' && (
        <FlashBanner tone="info" icon={<RotateCcw size={16} />}>
          Checkout was cancelled. Your current plan hasn&apos;t changed.
        </FlashBanner>
      )}
      {status === 'past_due' && (
        <FlashBanner tone="warn" icon={<AlertTriangle size={16} />}>
          Your last payment didn&apos;t go through. Open the billing portal to update your
          payment method — you still have access while Stripe retries.
        </FlashBanner>
      )}

      {/* Active plan card */}
      <section
        className="rounded-2xl border p-6"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl"
                style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
              >
                <Crown size={22} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                  Active plan
                </p>
                <h2 className="text-2xl font-bold text-foreground">{PLAN_LABELS[plan]}</h2>
              </div>
              <span
                className="ml-2 rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                style={{ background: statusStyle.bg, color: statusStyle.color, borderColor: statusStyle.border }}
              >
                {statusInfo.label}
              </span>
            </div>

            <dl className="mt-6 grid grid-cols-1 gap-x-10 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Billing cycle">
                {subscription?.billing_cycle === 'yearly' ? 'Yearly' : subscription?.billing_cycle === 'monthly' ? 'Monthly' : '—'}
              </Field>
              <Field label="Next renewal">
                {subscription?.cancel_at_period_end && renewal
                  ? `Cancels on ${renewal}`
                  : renewal ?? (plan === 'free' ? 'No active subscription' : '—')}
              </Field>
              <Field label="Trial ends">
                {subscription?.trial_ends_at
                  ? new Date(subscription.trial_ends_at).toLocaleDateString()
                  : '—'}
              </Field>
              <Field label="Payment status">
                <span style={{ color: statusStyle.color }}>{statusInfo.label}</span>
              </Field>
            </dl>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <button
              type="button"
              onClick={openPortal}
              disabled={openingPortal || !subscription}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
              style={{
                background: 'linear-gradient(180deg, var(--p-1), var(--p-2))',
                color: '#fff',
                opacity: openingPortal || !subscription ? 0.6 : 1,
                cursor: openingPortal || !subscription ? 'not-allowed' : 'pointer',
              }}
            >
              <ExternalLink size={15} />
              {openingPortal ? 'Opening…' : 'Manage billing'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/pricing')}
              className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              Change plan
            </button>
            {!subscription && (
              <p className="max-w-[220px] text-right text-xs" style={{ color: 'var(--text-3)' }}>
                You&apos;ll be able to manage billing here after your first checkout.
              </p>
            )}
            {portalError && (
              <p className="max-w-[260px] text-right text-xs" style={{ color: '#ef4444' }}>
                {portalError}
              </p>
            )}
          </div>
        </div>

        {subscription?.cancel_at_period_end && (
          <div
            className="mt-6 flex items-start gap-3 rounded-lg border p-3 text-sm"
            style={{ background: 'rgba(251,191,36,0.07)', borderColor: 'rgba(251,191,36,0.3)', color: 'rgba(251,191,36,0.9)' }}
          >
            <XCircle size={16} className="mt-0.5 shrink-0" />
            <span>
              Your subscription is scheduled to end on {renewal}. Reactivate it from the billing portal to keep premium
              features.
            </span>
          </div>
        )}
      </section>

      {/* Plan limits */}
      <section
        className="rounded-2xl border p-6"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">What&apos;s included</h3>
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>
              Limits for the {PLAN_LABELS[plan]} plan.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <LimitRow label="Workspaces" value={formatLimit(limits.maxWorkspaces)} />
          <LimitRow label="Servers per workspace" value={formatLimit(limits.maxServersPerWorkspace)} />
          <LimitRow label="Analytics retention" value={`${formatLimit(limits.analyticsRetentionDays)} days`} />
          <LimitRow label="Automations per server" value={formatLimit(limits.maxAutomationsPerGuild)} />
          <LimitRow label="Concurrent giveaways" value={formatLimit(limits.maxConcurrentGiveaways)} />
          <LimitRow label="Active tickets per server" value={formatLimit(limits.maxActiveTicketsPerGuild)} />
          <BoolRow label="AI moderation (Pulse Guard)" value={limits.aiModeration} />
          <BoolRow label="Advanced AI moderation" value={limits.advancedAiModeration} />
          <BoolRow label="Advanced moderation tools" value={limits.advancedModeration} />
          <BoolRow label="Custom bot branding" value={limits.customBranding} />
          <BoolRow label="Multi-server workspaces" value={limits.multiServerManagement} />
          <BoolRow label="Advanced analytics insights" value={limits.advancedAnalytics} />
          <BoolRow label="Backup & restore" value={limits.backupRestore} />
          <BoolRow label="API & webhook access" value={limits.apiAccess} />
          <BoolRow label="Priority support" value={limits.prioritySupport} />
        </div>
      </section>

      {/* Billing history */}
      <section
        className="rounded-2xl border p-6"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-foreground">Billing history</h3>
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>
              Recent invoices and subscription changes.
            </p>
          </div>
          <Receipt size={18} style={{ color: 'var(--text-3)' }} />
        </div>

        {events.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
            No billing activity yet.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--line-strong)' }}>
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium text-foreground">{formatEventType(e.event_type)}</p>
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {new Date(e.created_at).toLocaleString()}
                    {e.plan ? ` · ${PLAN_LABELS[e.plan as Plan] ?? e.plan}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {e.amount_cents != null && e.currency && (
                    <span className="font-mono text-sm" style={{ color: 'var(--text-2)' }}>
                      {formatAmount(e.amount_cents, e.currency)}
                    </span>
                  )}
                  {e.invoice_url && (
                    <a
                      href={e.invoice_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium"
                      style={{ color: 'var(--p-1)' }}
                    >
                      View invoice <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  )
}

function LimitRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b py-2" style={{ borderColor: 'var(--line-strong)' }}>
      <span style={{ color: 'var(--text-2)' }}>{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  )
}

function BoolRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between border-b py-2" style={{ borderColor: 'var(--line-strong)' }}>
      <span style={{ color: 'var(--text-2)' }}>{label}</span>
      <span
        className="rounded-full px-2 py-0.5 text-xs font-semibold"
        style={value
          ? { background: 'rgba(52,211,153,0.12)', color: '#34d399' }
          : { background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}
      >
        {value ? 'Included' : 'Not included'}
      </span>
    </div>
  )
}

function FlashBanner({
  tone,
  icon,
  children,
}: {
  tone: 'good' | 'warn' | 'info'
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const s = TONE_STYLES[tone]
  return (
    <div
      className="flex items-start gap-3 rounded-xl border p-4 text-sm"
      style={{ background: s.bg, borderColor: s.border, color: s.color }}
      role="status"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  )
}

function formatEventType(eventType: string): string {
  switch (eventType) {
    case 'checkout.session.completed': return 'Checkout completed'
    case 'customer.subscription.created': return 'Subscription started'
    case 'customer.subscription.updated': return 'Subscription updated'
    case 'customer.subscription.deleted': return 'Subscription ended'
    case 'invoice.payment_succeeded': return 'Payment received'
    case 'invoice.payment_failed': return 'Payment failed'
    default: return eventType.replace(/_/g, ' ')
  }
}

function formatAmount(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() })
      .format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}
