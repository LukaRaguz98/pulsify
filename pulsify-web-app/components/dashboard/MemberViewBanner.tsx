'use client'

import { useTransition } from 'react'
import { Eye, Loader2, Lock } from 'lucide-react'
import { setMemberView } from '@/app/dashboard/[guildId]/view-actions'

/**
 * Sticky indicator shown while an operator previews the dashboard in Member
 * View. Makes the downgraded state unmissable and offers the way back —
 * operator-only by construction (only operators can enable the preview).
 */
export function MemberViewBanner({ guildId }: { guildId: string }) {
  const [pending, startTransition] = useTransition()

  return (
    <div
      className="sticky top-0 z-20 flex flex-wrap items-center gap-2.5 border-b px-4 py-2 text-sm sm:px-6"
      style={{
        background: 'color-mix(in srgb, var(--p-1) 12%, var(--bg))',
        borderColor: 'var(--p-1)',
        color: 'var(--text)',
      }}
      title="Operator-only preview — you are seeing exactly what a regular member sees. Management modules are hidden and direct links to them redirect away."
    >
      <Eye size={15} style={{ color: 'var(--p-1)' }} />
      <span className="font-semibold">Member View active</span>
      <span className="hidden text-muted-foreground sm:inline">
        You&apos;re previewing the dashboard exactly as a regular member sees it.
      </span>
      <span
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
        style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
      >
        <Lock size={10} />
        Operator
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => setMemberView(guildId, false))}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60"
        style={{ borderColor: 'var(--p-1)', color: 'var(--p-1)' }}
      >
        {pending && <Loader2 size={12} className="animate-spin" />}
        Exit Member View
      </button>
    </div>
  )
}
