import Link from 'next/link'
import { MessageSquarePlus } from 'lucide-react'
import { SectionHeading } from './landing-ui'
import { EarlyAccessButton, InvitePulseButton } from './LandingCtas'
import { getTopFeedback } from '@/lib/feedback-server'
import { CommunityFeedback } from '@/components/feedback/CommunityFeedback'

/**
 * Social-proof section. Shows ONLY the top-rated real community feedback
 * (PULSIFY-39) — the top 3 entries. No placeholder/illustrative quotes: until
 * the first real reviews land, this renders a clean empty state inviting people
 * to be the first. CTAs point into the full /feedback wall.
 */
export async function Community() {
  const top = await getTopFeedback(3)

  return (
    <section className="mx-auto max-w-7xl px-6 py-16">
      <SectionHeading
        eyebrow="Community"
        title="Built with community builders"
        subtitle="Pulsify is shaped by the people who run real Discord servers every day."
      />

      {top.length > 0 ? (
        <CommunityFeedback items={top} />
      ) : (
        <div
          className="mt-12 flex flex-col items-center rounded-2xl border border-dashed px-6 py-16 text-center"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
        >
          <span
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            <MessageSquarePlus size={26} />
          </span>
          <p className="mt-5 text-lg font-semibold text-foreground">No reviews yet</p>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Be the first to share what you think about Pulsify — your feedback will be showcased
            right here.
          </p>
          <Link
            href="/feedback"
            className="mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all"
            style={{
              background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
              boxShadow: '0 6px 20px -6px var(--p-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
            }}
          >
            Leave the first review
          </Link>
        </div>
      )}
    </section>
  )
}

export function FinalCta() {
  return (
    <section className="mx-auto max-w-7xl px-6 pb-16">
      <div
        className="relative overflow-hidden rounded-3xl border px-6 py-16 text-center"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div
          aria-hidden
          className="lp-blob pointer-events-none absolute -top-24 left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full opacity-50 blur-[120px]"
          style={{ background: 'radial-gradient(circle, var(--p-glow), transparent 70%)' }}
        />
        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Ready to run your community like a pro?
          </h2>
          <p className="mt-4 text-base" style={{ color: 'var(--text-2)' }}>
            Invite the Pulse bot, sign in with Discord, and get your whole server under control in minutes.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <EarlyAccessButton variant="primary" size="lg" />
            <InvitePulseButton variant="secondary" size="lg" />
          </div>
          <p className="mt-4 text-sm" style={{ color: 'var(--text-3)' }}>
            No credit card required · Free tier available
          </p>
        </div>
      </div>
    </section>
  )
}
