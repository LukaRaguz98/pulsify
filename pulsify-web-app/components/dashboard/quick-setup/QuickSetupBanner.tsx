'use client'

import { useState, useSyncExternalStore } from 'react'
import { Wand2, ArrowRight, X } from 'lucide-react'
import { QuickSetupWizard } from './QuickSetupWizard'

// localStorage-backed dismissal read via useSyncExternalStore: SSR/hydration use
// the `false` server snapshot, then the client reads the persisted value — no
// setState-in-effect, no hydration mismatch.
const subscribe = (cb: () => void) => {
  window.addEventListener('storage', cb)
  return () => window.removeEventListener('storage', cb)
}

/**
 * Overview "Quick setup" nudge. Opens a short wizard that turns a few
 * preferences into a ready-to-use, editable library template (and optionally
 * applies it). Shown until the user has saved a setup or dismisses it; dismissal
 * is remembered client-side so it stays out of the way without a server write.
 */
export function QuickSetupBanner({
  guildId,
  guildName,
}: {
  guildId: string
  guildName: string
}) {
  const key = `pulsify:quick-setup-nudge:${guildId}`
  const persistedDismissed = useSyncExternalStore(
    subscribe,
    () => {
      try { return localStorage.getItem(key) === 'dismissed' } catch { return false }
    },
    () => false,
  )
  const [locallyDismissed, setLocallyDismissed] = useState(false)
  const [open, setOpen] = useState(false)

  if (persistedDismissed || locallyDismissed) return null

  function dismiss() {
    try { localStorage.setItem(key, 'dismissed') } catch {}
    setLocallyDismissed(true)
  }

  return (
    <>
      <div
        className="relative mb-8 overflow-hidden rounded-2xl border p-6"
        style={{ background: 'var(--panel)', borderColor: 'var(--p-1)' }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full blur-[90px]"
          style={{ background: 'radial-gradient(circle, var(--p-glow), transparent 70%)', opacity: 0.5 }}
        />
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-3 top-3 rounded-md p-1.5 transition-colors"
          style={{ color: 'var(--text-3)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
        >
          <X size={15} />
        </button>

        {/* sm:pr-8 keeps the "Start quick setup" button clear of the absolute
            dismiss (×) in the top-right corner. */}
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:pr-8">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))', boxShadow: '0 6px 20px -6px var(--p-glow)' }}
          >
            <Wand2 size={24} />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight text-foreground">
              Get {guildName} configured in minutes
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-2)' }}>
              Pick a preset and Pulsify switches on the right features — welcome, onboarding, safety, engagement and more — saved as an editable profile in your library.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all active:translate-y-px"
            style={{ background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)', boxShadow: '0 6px 20px -6px var(--p-glow)' }}
          >
            Start quick setup
            <ArrowRight size={16} />
          </button>
        </div>
      </div>

      {open && (
        <QuickSetupWizard guildId={guildId} guildName={guildName} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
