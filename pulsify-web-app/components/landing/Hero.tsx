import Image from 'next/image'
import { Sparkles } from 'lucide-react'
import { TRUST_BADGES } from './landing-data'
import { Eyebrow } from './landing-ui'
import { EarlyAccessButton, InvitePulseButton, OpenDashboardButton } from './LandingCtas'

export function Hero({ isAuthed = false }: { isAuthed?: boolean }) {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* Animated gradient blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="lp-blob absolute -top-32 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full opacity-60 blur-[120px]"
          style={{ background: 'radial-gradient(circle, var(--p-glow), transparent 70%)' }}
        />
        <div
          className="lp-blob-alt absolute -right-24 top-40 h-[360px] w-[360px] rounded-full opacity-40 blur-[120px]"
          style={{ background: 'radial-gradient(circle, var(--cyan), transparent 70%)' }}
        />
        <div
          className="lp-blob absolute -left-24 top-64 h-[320px] w-[320px] rounded-full opacity-30 blur-[120px]"
          style={{ background: 'radial-gradient(circle, var(--pink), transparent 70%)' }}
        />
      </div>

      <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-7 px-6 pb-14 pt-16 text-center sm:pt-24">
        <div className="lp-fade-up">
          <Eyebrow>
            <Sparkles size={12} /> Now in early access
          </Eyebrow>
        </div>

        <div className="lp-fade-up flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Pulsify"
            width={44}
            height={44}
            priority
            style={{ filter: 'drop-shadow(0 8px 24px var(--p-glow))' }}
          />
          <span className="text-2xl font-bold tracking-tight" style={{ color: 'var(--p-1)' }}>
            Pulsify
          </span>
        </div>

        <h1 className="lp-fade-up-1 max-w-3xl text-balance text-4xl font-bold leading-[1.08] tracking-tight text-foreground sm:text-6xl">
          Everything your Discord needs,
          <br className="hidden sm:block" /> in <span className="lp-gradient-text">one dashboard</span>.
        </h1>

        <p className="lp-fade-up-1 max-w-xl text-lg leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Moderation, AI safety, analytics, events and automations — powered by the Pulse bot and a
          dashboard your whole team will actually enjoy using.
        </p>

        <div className="lp-fade-up-2 mt-1 flex flex-col flex-wrap items-center justify-center gap-3 sm:flex-row">
          {isAuthed ? (
            <OpenDashboardButton variant="primary" size="lg" />
          ) : (
            <EarlyAccessButton variant="primary" size="lg" />
          )}
          <InvitePulseButton variant="secondary" size="lg" />
        </div>

        <p className="lp-fade-up-2 text-sm" style={{ color: 'var(--text-3)' }}>
          No credit card required · Free tier available
        </p>

        {/* Trust badges */}
        <div className="lp-fade-up-3 mt-4 flex flex-wrap items-center justify-center gap-2.5">
          {TRUST_BADGES.map((b) => (
            <span
              key={b.label}
              className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <b.icon size={13} style={{ color: 'var(--p-1)' }} />
              {b.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
