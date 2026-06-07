import Link from 'next/link'
import { PUBLIC_PAGES } from '@/lib/public-nav'

// Sits at the bottom of every dashboard page. Uses the current year so we
// don't have to revisit this every January. The page links mirror the public
// sub-nav exactly (same pages, same order) via the shared PUBLIC_PAGES list.
export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer
      data-app-footer="true"
      className="mt-12 px-6 py-5 text-xs"
      style={{ color: 'var(--text-3)' }}
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col items-center gap-0.5 sm:items-start">
          <p>
            © {year} Powered by{' '}
            <span style={{ color: 'var(--p-1)' }}>Pulsify</span>. All rights reserved.
          </p>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {PUBLIC_PAGES.map((p) => (
            <Link key={p.href} href={p.href} className="transition-colors hover:text-[var(--p-1)]">
              {p.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
