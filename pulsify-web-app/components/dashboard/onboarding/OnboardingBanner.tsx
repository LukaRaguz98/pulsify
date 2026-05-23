'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Rocket, ArrowRight, X, Loader2 } from 'lucide-react'
import { STEP_COUNT, type OnboardingState } from '@/lib/onboarding'
import { skipOnboarding } from '@/app/dashboard/[guildId]/onboarding/actions'

/**
 * First-run entry point on the server overview. Shown until onboarding is
 * completed or skipped; resumes at the saved step. Dismissing marks it skipped
 * so it won't reappear (the wizard stays reachable at /onboarding).
 */
export function OnboardingBanner({
  guildId,
  guildName,
  state,
}: {
  guildId: string
  guildName: string
  state: OnboardingState | null
}) {
  const router = useRouter()
  const [dismissing, setDismissing] = useState(false)

  const inProgress = !!state && state.status === 'in_progress' && state.step > 0
  const stepLabel = inProgress ? Math.min(state!.step + 1, STEP_COUNT) : 1
  const progress = inProgress ? Math.round((state!.step / STEP_COUNT) * 100) : 0

  async function dismiss() {
    setDismissing(true)
    await skipOnboarding(guildId).catch(() => {})
    router.refresh()
  }

  return (
    <div
      className="relative mb-8 overflow-hidden rounded-2xl border p-6"
      style={{ background: 'var(--panel)', borderColor: 'var(--p-1)' }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full blur-[90px]"
        style={{ background: 'radial-gradient(circle, var(--p-glow), transparent 70%)', opacity: 0.5 }}
      />
      <button
        type="button"
        onClick={dismiss}
        disabled={dismissing}
        aria-label="Dismiss setup"
        className="absolute right-3 top-3 rounded-md p-1.5 transition-colors disabled:opacity-50"
        style={{ color: 'var(--text-3)' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
      >
        {dismissing ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
      </button>

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))', boxShadow: '0 6px 20px -6px var(--p-glow)' }}
        >
          <Rocket size={24} />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold tracking-tight text-foreground">
            {inProgress ? `Finish setting up ${guildName}` : `Welcome to Pulsify — let’s set up ${guildName}`}
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-2)' }}>
            {inProgress
              ? `You’re on step ${stepLabel} of ${STEP_COUNT}. Pick up where you left off.`
              : 'A quick guided setup configures moderation, welcomes, auto-roles and Pulse Guard in a couple of minutes.'}
          </p>
          {inProgress && (
            <div className="mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, var(--p-1), var(--p-2))' }} />
            </div>
          )}
        </div>

        <Link
          href={`/dashboard/${guildId}/onboarding`}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all active:translate-y-px"
          style={{ background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)', boxShadow: '0 6px 20px -6px var(--p-glow)' }}
        >
          {inProgress ? 'Resume setup' : 'Start setup'}
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
