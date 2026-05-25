'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDiscordSignIn } from './LandingCtas'

/**
 * Footer "Dashboard" link that behaves like the nav's dashboard/sign-in CTA:
 * if the visitor has a session it routes straight to /dashboard, otherwise it
 * kicks off the Discord OAuth flow (returning to /dashboard afterwards).
 *
 * The plain `/dashboard` link used to just bounce logged-out visitors back to
 * the landing page (the proxy redirects `/dashboard` → `/` with no session),
 * which read as a dead link.
 */
export function FooterDashboardLink({
  className,
  style,
  children,
}: {
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const router = useRouter()
  const { signIn, pending } = useDiscordSignIn('/dashboard')

  useEffect(() => {
    const supabase = createClient()
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) setAuthed(!!data.session)
    })
    return () => {
      active = false
    }
  }, [])

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    // `authed === false` (or still resolving) → send to login; the session
    // check resolves from local storage within a frame, well before a footer
    // click is realistic.
    if (authed) router.push('/dashboard')
    else void signIn()
  }

  return (
    <Link href="/dashboard" onClick={handleClick} className={className} style={style} aria-busy={pending || undefined}>
      {children}
    </Link>
  )
}
