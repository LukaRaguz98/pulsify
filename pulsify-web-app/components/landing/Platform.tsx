import { STEPS, WHY_POINTS } from './landing-data'
import { SectionHeading } from './landing-ui'

export function HowItWorks() {
  return (
    <section id="how" className="lp-anchor mx-auto max-w-7xl px-6 py-16">
      <SectionHeading
        eyebrow="How it works"
        title="From invite to insight in minutes"
        subtitle="No config files, no hosting, no headaches. Pulsify is live the moment the bot joins."
      />

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <div
            key={s.title}
            className="lp-card relative rounded-2xl border p-5"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            <span
              className="text-xs font-bold tracking-widest"
              style={{ color: 'var(--p-1)' }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <div
              className="mt-3 flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
            >
              <s.icon size={20} />
            </div>
            <h3 className="mt-4 text-base font-semibold text-foreground">{s.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {s.desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

export function WhyPulsify() {
  return (
    <section
      id="why"
      className="lp-anchor relative overflow-hidden border-y"
      style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
    >
      <div className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeading
          eyebrow="Why Pulsify"
          title="Built to replace your whole bot stack"
          subtitle="Powerful where it counts, simple where it matters — the dashboard your team will actually want to open."
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {WHY_POINTS.map((p) => (
            <div
              key={p.title}
              className="lp-card flex gap-4 rounded-2xl border p-5"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
              >
                <p.icon size={20} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">{p.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  {p.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
