'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

// The four public pages, surfaced as a contextual sub-nav so you can hop
// between them and always see which one you're on.
const PAGES = [
  { href: '/faq', label: 'FAQ' },
  { href: '/support', label: 'Support' },
  { href: '/community', label: 'Community' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
]

/**
 * Slim bar under the header. Gives every public page a clear way back to where
 * the user came from (the dashboard for signed-in admins, the homepage for
 * visitors) plus quick navigation between the public pages with an active
 * indicator — the two things the bare marketing header was missing.
 */
export function PublicBreadcrumb({ authed }: { authed: boolean }) {
  const pathname = usePathname()
  const back = authed
    ? { href: '/dashboard', label: 'Back to dashboard' }
    : { href: '/', label: 'Back to home' }

  return (
    <div
      className="border-b"
      style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--bg-2) 55%, transparent)' }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-3">
        <Link
          href={back.href}
          className="group inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
          style={{ color: 'var(--text-2)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-2)' }}
        >
          <ChevronLeft size={16} className="transition-transform group-hover:-translate-x-0.5" />
          {back.label}
        </Link>

        <nav className="flex flex-wrap items-center gap-1" aria-label="Public pages">
          {PAGES.map((p) => {
            const active = pathname === p.href
            return (
              <Link
                key={p.href}
                href={p.href}
                aria-current={active ? 'page' : undefined}
                className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  color: active ? 'var(--text)' : 'var(--text-3)',
                  background: active ? 'var(--p-soft)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = 'var(--text)'
                    e.currentTarget.style.background = 'var(--panel)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = 'var(--text-3)'
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                {p.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
