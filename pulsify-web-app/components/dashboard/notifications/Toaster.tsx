'use client'

import { useRouter } from 'next/navigation'
import { X, AlertCircle } from 'lucide-react'
import { useNotifications } from './NotificationsProvider'
import { SEVERITY_BG, SEVERITY_COLOR } from './notification-style'
import { CATEGORY_LABELS } from '@/lib/notifications'

/**
 * Renders live notification toasts in the bottom-right corner. Pulls events
 * from NotificationsProvider, so it's purely presentational — the provider
 * handles real-time subscription and user preference gating.
 */
export function Toaster() {
  const router = useRouter()
  const { toasts, dismissToast, markRead } = useNotifications()

  if (toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const n = t.notification
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-2xl transition-all"
            style={{
              background: 'var(--panel)',
              borderColor: 'var(--line-strong)',
              animation: 'pulsify-toast-in 220ms ease',
            }}
          >
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              style={{ background: SEVERITY_BG[n.severity], color: SEVERITY_COLOR[n.severity] }}
            >
              <AlertCircle size={14} />
            </span>
            <button
              type="button"
              onClick={() => {
                markRead([n.id])
                dismissToast(t.id)
                if (n.link) router.push(n.link)
              }}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-sm font-semibold text-foreground">{n.title}</p>
              {n.body && (
                <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: 'var(--text-3)' }}>{n.body}</p>
              )}
              <p className="mt-0.5 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                {CATEGORY_LABELS[n.category]}
              </p>
            </button>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded-md p-1 transition"
              style={{ color: 'var(--text-3)' }}
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
      <style jsx>{`
        @keyframes pulsify-toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
