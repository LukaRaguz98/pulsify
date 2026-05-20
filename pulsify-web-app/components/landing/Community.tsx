import { Star } from 'lucide-react'
import { TESTIMONIALS } from './landing-data'
import { SectionHeading } from './landing-ui'
import { EarlyAccessButton, InvitePulseButton } from './LandingCtas'

export function Community() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-16">
      <SectionHeading
        eyebrow="Community"
        title="Built with community builders"
        subtitle="Pulsify is shaped by the people who run real Discord servers every day."
      />

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {TESTIMONIALS.map((t) => (
          <div
            key={t.name}
            className="lp-card flex flex-col rounded-2xl border p-6"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            <div className="flex gap-0.5" style={{ color: 'var(--amber)' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} size={14} fill="currentColor" />
              ))}
            </div>
            <p className="mt-4 flex-1 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              “{t.quote}”
            </p>
            <div className="mt-5 flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
              >
                {t.initial}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{t.name}</p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>{t.role}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-center text-xs" style={{ color: 'var(--text-3)' }}>
        Community quotes shown for illustration during early access.
      </p>
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
