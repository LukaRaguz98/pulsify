import { FEATURES } from './landing-data'
import { SectionHeading } from './landing-ui'

export function Features() {
  return (
    <section id="features" className="lp-anchor mx-auto max-w-7xl px-6 py-16">
      <SectionHeading
        eyebrow="Platform"
        title="One platform, every system you need"
        subtitle="Pulsify ships with the full toolkit for running a healthy Discord community — no add-ons, no extra bots."
      />

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="lp-card group rounded-2xl border p-5"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            <div
              className="flex h-11 w-11 items-center justify-center rounded-xl transition-transform group-hover:scale-110"
              style={{ background: `color-mix(in srgb, ${f.accent} 14%, transparent)`, color: f.accent }}
            >
              <f.icon size={20} />
            </div>
            <h3 className="mt-4 text-base font-semibold text-foreground">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {f.desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
