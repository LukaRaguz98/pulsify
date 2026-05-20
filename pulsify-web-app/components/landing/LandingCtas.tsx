'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Bot, LayoutDashboard, Loader2, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { botInviteUrl } from '@/lib/discord'

type Size = 'sm' | 'md' | 'lg'
type Variant = 'primary' | 'secondary'

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-3.5 py-2 text-xs',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-6 py-3 text-sm',
}

function baseClasses(size: Size, full?: boolean) {
  return `inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all active:translate-y-px ${SIZE_CLASSES[size]} ${full ? 'w-full' : ''}`
}

function primaryStyle(): React.CSSProperties {
  return {
    background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
    color: '#fff',
    boxShadow: '0 6px 20px -6px var(--p-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
  }
}

function secondaryStyle(): React.CSSProperties {
  return {
    background: 'var(--panel)',
    color: 'var(--text)',
    border: '1px solid var(--line-strong)',
  }
}

const DiscordGlyph = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.001.022.015.043.032.055a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
)

/** Opens the Discord OAuth flow, same as the legacy LoginButton. */
export function useDiscordSignIn(redirectAfter = '/dashboard') {
  const [pending, setPending] = useState(false)
  const signIn = async () => {
    setPending(true)
    const supabase = createClient()
    const next = encodeURIComponent(redirectAfter)
    await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${next}`,
        scopes: 'identify email guilds',
        queryParams: { prompt: 'consent' },
      },
    })
  }
  return { signIn, pending }
}

export function InvitePulseButton({ variant = 'secondary', size = 'lg', full }: { variant?: Variant; size?: Size; full?: boolean }) {
  return (
    <a
      href={botInviteUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className={baseClasses(size, full)}
      style={variant === 'primary' ? primaryStyle() : secondaryStyle()}
    >
      <Bot size={16} />
      Invite Pulse
    </a>
  )
}

export function OpenDashboardButton({ variant = 'secondary', size = 'lg', full }: { variant?: Variant; size?: Size; full?: boolean }) {
  return (
    <Link
      href="/dashboard"
      className={baseClasses(size, full)}
      style={variant === 'primary' ? primaryStyle() : secondaryStyle()}
    >
      <LayoutDashboard size={16} />
      Open Dashboard
    </Link>
  )
}

export function EarlyAccessButton({
  variant = 'primary',
  size = 'lg',
  full,
  label = 'Join Early Access',
}: { variant?: Variant; size?: Size; full?: boolean; label?: string }) {
  const { signIn, pending } = useDiscordSignIn()
  return (
    <button
      type="button"
      onClick={signIn}
      disabled={pending}
      className={`${baseClasses(size, full)} disabled:opacity-70`}
      style={variant === 'primary' ? primaryStyle() : secondaryStyle()}
    >
      {pending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
      {label}
    </button>
  )
}

/** Plain Discord sign-in button (used in the nav). */
export function SignInButton({ size = 'sm' }: { size?: Size }) {
  const { signIn, pending } = useDiscordSignIn()
  return (
    <button
      type="button"
      onClick={signIn}
      disabled={pending}
      className={`${baseClasses(size)} disabled:opacity-70`}
      style={primaryStyle()}
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : <DiscordGlyph size={14} />}
      Sign in
    </button>
  )
}
