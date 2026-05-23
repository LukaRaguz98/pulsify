import Image from 'next/image'
import Link from 'next/link'
import { TRUST_BADGES } from './landing-data'

const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'How it works', href: '#how' },
      { label: 'Dashboard', href: '/dashboard' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'FAQ', href: '/faq' },
      { label: 'Support', href: '/support' },
      { label: 'Community', href: '/community' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
    ],
  },
]

export function LandingFooter() {
  const year = new Date().getFullYear()
  return (
    <footer
      className="border-t"
      style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
    >
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2.5">
              <Image
                src="/logo.png"
                alt="Pulsify"
                width={28}
                height={28}
                style={{ filter: 'drop-shadow(0 4px 14px var(--p-glow))' }}
              />
              <span className="text-lg font-bold tracking-tight" style={{ color: 'var(--p-1)' }}>
                Pulsify
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed" style={{ color: 'var(--text-3)' }}>
              The modern, AI-powered dashboard for Discord community management.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {TRUST_BADGES.map((b) => (
                <span
                  key={b.label}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
                  style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
                >
                  <b.icon size={11} style={{ color: 'var(--p-1)' }} />
                  {b.label}
                </span>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                {col.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) =>
                  l.external ? (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm transition-colors hover:text-[var(--p-1)]"
                        style={{ color: 'var(--text-2)' }}
                      >
                        {l.label}
                      </a>
                    </li>
                  ) : l.href.startsWith('#') ? (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        className="text-sm transition-colors hover:text-[var(--p-1)]"
                        style={{ color: 'var(--text-2)' }}
                      >
                        {l.label}
                      </a>
                    </li>
                  ) : (
                    <li key={l.label}>
                      <Link
                        href={l.href}
                        className="text-sm transition-colors hover:text-[var(--p-1)]"
                        style={{ color: 'var(--text-2)' }}
                      >
                        {l.label}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>

        <div
          className="mt-12 flex flex-col items-center justify-between gap-3 border-t pt-6 text-xs sm:flex-row"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
        >
          <p>
            © {year} Pulsify. All rights reserved.
          </p>
          <p>
            Powered by the <span style={{ color: 'var(--p-1)' }}>Pulse</span> bot.
          </p>
        </div>
      </div>
    </footer>
  )
}
