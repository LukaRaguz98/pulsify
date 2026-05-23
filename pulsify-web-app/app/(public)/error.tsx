'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCcw } from 'lucide-react'

// Route-level error boundary for the public pages. Branded, with a retry and a
// way back home so a transient failure never leaves a blank screen.
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[public] page error:', error)
  }, [error])

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center sm:py-32">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}
      >
        <AlertTriangle size={26} />
      </span>
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Something went wrong</h1>
      <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
        This page failed to load. Please try again — if it keeps happening, let us know in our community.
      </p>
      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all active:translate-y-px"
          style={{
            background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
            color: '#fff',
            boxShadow: '0 6px 20px -6px var(--p-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
          }}
        >
          <RotateCcw size={16} />
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all active:translate-y-px"
          style={{ background: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--line-strong)' }}
        >
          Back to home
        </Link>
      </div>
    </div>
  )
}
