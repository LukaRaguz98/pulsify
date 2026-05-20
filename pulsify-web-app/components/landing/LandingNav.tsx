'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { InvitePulseButton, SignInButton } from './LandingCtas'

const LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how' },
  { label: 'Why Pulsify', href: '#why' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

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
      <nav
        className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3.5"
        style={{ transform: 'translateX(57px)' }}
      >
        <a href="#top" className="flex items-center gap-2.5">
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
        </a>

        {/* Desktop links */}
        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium transition-colors"
              style={{ color: 'var(--text-2)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-2)' }}
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-2.5 md:flex">
          <InvitePulseButton variant="secondary" size="sm" />
          <SignInButton />
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border md:hidden"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div
          className="md:hidden"
          style={{ background: 'var(--bg)', borderBottom: '1px solid var(--line-strong)' }}
        >
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-6 pb-5 pt-1">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium"
                style={{ color: 'var(--text-2)' }}
              >
                {l.label}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              <InvitePulseButton variant="secondary" size="md" full />
              <SignInButton size="md" />
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
