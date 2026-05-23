'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { InvitePulseButton, SignInButton, OpenDashboardButton } from '@/components/landing/LandingCtas'

/**
 * Sub-page header for the public pages. Deliberately minimal — brand on the
 * left, a context-aware CTA on the right — so it never feels like the marketing
 * nav got stranded on a legal page. The per-page navigation (and the way back)
 * lives in the breadcrumb bar just below. The CTA adapts to auth state: a
 * signed-in admin gets "Open Dashboard", a visitor gets Invite + Sign in.
 */
export function PublicHeader({ authed }: { authed: boolean }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className="sticky top-0 z-40 transition-colors"
      style={{
        background: scrolled ? 'color-mix(in srgb, var(--bg) 82%, transparent)' : 'transparent',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        borderBottom: `1px solid ${scrolled ? 'var(--line-strong)' : 'transparent'}`,
      }}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Pulsify"
            width={32}
            height={32}
            className="shrink-0"
            style={{ filter: 'drop-shadow(0 4px 14px var(--p-glow))' }}
            priority
          />
          <span className="text-lg font-bold tracking-tight" style={{ color: 'var(--p-1)' }}>
            Pulsify
          </span>
        </Link>

        <div className="flex items-center gap-2.5">
          {authed ? (
            <OpenDashboardButton variant="primary" size="sm" />
          ) : (
            <>
              <span className="hidden sm:inline-flex">
                <InvitePulseButton variant="secondary" size="sm" />
              </span>
              <SignInButton />
            </>
          )}
        </div>
      </nav>
    </header>
  )
}
