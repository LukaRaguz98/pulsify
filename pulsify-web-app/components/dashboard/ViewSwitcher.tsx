'use client'

import { useTransition } from 'react'
import { Eye, Loader2, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setMemberView } from '@/app/dashboard/[guildId]/view-actions'

/**
 * Operator-only entry into the Member View preview, so operators can verify
 * exactly what regular members see. Enter-only: while the preview is active
 * this button isn't rendered — the sticky MemberViewBanner at the top owns
 * "Exit Member View". The toggle is enforced server-side too.
 *
 * Floating icon in the top-right chrome, directly below the tour launcher
 * (bell mt-[40px] → tour mt-[84px] → this mt-[128px], 44px steps). Like the
 * bell/launcher, the inset assumes the HUD corner bracket — when corner
 * decorations are off, the [data-view-switcher] rule in globals.css pulls it
 * to the corner in step with them. On mobile the chrome corners belong to
 * the top bar (bell + ping), so it drops just below the bar instead.
 */
export function ViewSwitcher({ guildId }: { guildId: string }) {
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      data-view-switcher="true"
      disabled={pending}
      onClick={() => startTransition(() => setMemberView(guildId, true))}
      title="Operator-only — preview the dashboard exactly as a regular member sees it (read-only nav, no management modules)."
      aria-label="Preview the dashboard as a member"
      className={cn(
        'relative flex fixed z-[9] top-2 right-3 mt-[128px] mr-[40px] h-9 w-9 items-center justify-center',
        'max-lg:top-[56px] max-lg:mt-0 max-lg:mr-0',
        'rounded-md border bg-[var(--panel)] border-[var(--line-strong)] text-[var(--p-1)]',
        'transition-all duration-150 disabled:opacity-60 hover:bg-[var(--p-soft)] hover:border-[var(--p-1)]',
        'hover:-translate-y-0.5 hover:shadow-[0_4px_12px_-4px_var(--p-glow)] active:translate-y-0 active:shadow-none',
      )}
    >
      {pending ? <Loader2 size={18} className="animate-spin" /> : <Eye size={18} />}
      {/* Corner lock marks this as an operator-only action, matching the
          lock on the Member View banner / other operator surfaces. */}
      <span
        aria-hidden="true"
        className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-white"
        style={{ background: 'var(--p-1)', boxShadow: '0 0 0 2px var(--bg)', opacity: 0.75 }}
      >
        <Lock size={8} />
      </span>
    </button>
  )
}
