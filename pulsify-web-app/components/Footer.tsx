import Link from 'next/link'

// Sits at the bottom of every dashboard page. Uses the current year so we
// don't have to revisit this every January.
export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer
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
          <Link href="/privacy" className="transition-colors hover:text-[var(--p-1)]">
            Privacy Policy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-[var(--p-1)]">
            Terms of Service
          </Link>
          <Link href="/support" className="transition-colors hover:text-[var(--p-1)]">
            Support
          </Link>
          <a
            href="https://discord.gg"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-[var(--p-1)]"
          >
            Community
          </a>
        </nav>
      </div>
    </footer>
  )
}
