'use client'

import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase'

type Props = {
  /** Where to return after re-auth. Defaults to the current page. */
  redirectAfter?: string
  /** Style — banner uses 'inline', the full page uses 'primary'. */
  variant?: 'inline' | 'primary'
  label?: string
}

/**
 * Re-runs the Discord OAuth flow while leaving the supabase session intact.
 * Useful for the "Discord session expired" banner — gives the user a single
 * click to repair their token cache instead of forcing a full logout.
 */
export function ReconnectDiscordButton({
  redirectAfter,
  variant = 'inline',
  label = 'Reconnect Discord',
}: Props) {
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    setBusy(true)
    const supabase = createClient()
    const fallback = typeof window === 'undefined'
      ? '/dashboard'
      : window.location.pathname + window.location.search
    const next = encodeURIComponent(redirectAfter ?? fallback)
    await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${next}`,
        scopes: 'identify email guilds',
        // Force Discord to mint a fresh refresh token. Skipping `prompt=consent`
        // is what causes Discord to silently re-issue an access-only response
        // and leave the user in the same expired state they came in with.
        queryParams: { prompt: 'consent' },
      },
    })
  }

  if (variant === 'primary') {
    return (
      <button
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50"
        style={{
          background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
          boxShadow: '0 4px 14px -4px var(--p-glow)',
        }}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {label}
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
      style={{ borderColor: 'rgba(245,158,11,0.4)', color: '#f59e0b' }}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
      {label}
    </button>
  )
}
