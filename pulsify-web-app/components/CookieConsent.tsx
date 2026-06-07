'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Cookie } from 'lucide-react'

const CONSENT_COOKIE = 'pulsify_cookie_consent'

/** Persist the visitor's choice for a year so the banner doesn't reappear. */
function setConsent(value: 'accepted' | 'declined') {
  document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
}

// Nothing external mutates the consent cookie behind our back, so the store
// never needs to push updates — the in-component `dismissed` state handles the
// click. useSyncExternalStore is used purely so SSR renders nothing (server
// snapshot = "chosen") and the client reads the real cookie after hydration
// without a mismatch or a synchronous setState-in-effect.
const noopSubscribe = () => () => {}
const hasChosen = () =>
  document.cookie.split('; ').some((c) => c.startsWith(`${CONSENT_COOKIE}=`))

/**
 * First-visit cookie consent banner. The app sets cookies for the Supabase
 * session and for UI preferences, so we surface a notice on entry.
 *
 * Deliberately NOT `role="dialog"`: a global rule in globals.css hides the
 * dashboard chrome (notification bell / ping) whenever a dialog is present in
 * the DOM, and this banner can render over the app. It's a non-modal region
 * instead — it never traps focus or blocks the page.
 */
export function CookieConsent() {
  const chosen = useSyncExternalStore(noopSubscribe, hasChosen, () => true)
  const [dismissed, setDismissed] = useState(false)

  if (chosen || dismissed) return null

  const choose = (value: 'accepted' | 'declined') => {
    setConsent(value)
    setDismissed(true)
  }

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[100] flex justify-center px-4 pb-4"
    >
      <div
        className="flex w-full max-w-3xl flex-col gap-3 rounded-2xl border p-4 shadow-2xl backdrop-blur-md sm:flex-row sm:items-center sm:gap-4 sm:p-5"
        style={{
          background: 'color-mix(in srgb, var(--panel) 92%, transparent)',
          borderColor: 'var(--line-strong)',
        }}
      >
        <div className="flex items-start gap-3">
          <Cookie size={20} className="mt-0.5 shrink-0" style={{ color: 'var(--p-1)' }} />
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
            We use cookies to keep you signed in and remember your preferences. See our{' '}
            <Link
              href="/privacy"
              className="font-medium underline underline-offset-2"
              style={{ color: 'var(--p-1)' }}
            >
              Privacy Policy
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 gap-2 sm:ml-auto">
          <button
            type="button"
            onClick={() => choose('declined')}
            className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors"
            style={{ background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line-strong)' }}
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => choose('accepted')}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all active:translate-y-px"
            style={{
              background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
              boxShadow: '0 6px 20px -6px var(--p-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
            }}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
