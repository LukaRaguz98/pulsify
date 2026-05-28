'use client'

import { useCallback, useState } from 'react'
import { CheckCircle2, AlertTriangle, X } from 'lucide-react'

export type Feedback = { kind: 'success' | 'error'; text: string } | null

type Result = { ok: true } | { ok: true; data: unknown } | { ok: false; error: string }

/**
 * Shared action runner for workspace content components — mirrors the
 * `runAction` pattern used by the giveaways/tickets dashboards: tracks a busy
 * flag and surfaces success/error feedback in one place.
 */
export function useRunAction() {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const run = useCallback(async <T extends Result>(fn: () => Promise<T>, successMsg?: string): Promise<T> => {
    setBusy(true)
    setFeedback(null)
    let res: T
    try {
      res = await fn()
    } catch {
      res = { ok: false, error: 'Something went wrong. Please try again.' } as T
    }
    setBusy(false)
    if (res.ok) {
      if (successMsg) setFeedback({ kind: 'success', text: successMsg })
    } else {
      setFeedback({ kind: 'error', text: (res as { error: string }).error })
    }
    return res
  }, [])

  return { busy, feedback, setFeedback, run }
}

export function FeedbackBanner({ feedback, onClose }: { feedback: Feedback; onClose: () => void }) {
  if (!feedback) return null
  const err = feedback.kind === 'error'
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
      style={{
        borderColor: err ? 'rgba(239,68,68,0.35)' : 'rgba(52,211,153,0.35)',
        background: err ? 'rgba(239,68,68,0.08)' : 'rgba(52,211,153,0.08)',
        color: err ? '#f87171' : '#34d399',
      }}
    >
      {err ? <AlertTriangle size={14} className="shrink-0" /> : <CheckCircle2 size={14} className="shrink-0" />}
      <span className="flex-1">{feedback.text}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="opacity-70 transition hover:opacity-100">
        <X size={14} />
      </button>
    </div>
  )
}

/** Compact avatar for a workspace member / Discord user, with initial fallback. */
export function Avatar({ name, url, size = 32 }: { name: string | null; url: string | null; size?: number }) {
  const label = (name ?? '?').charAt(0).toUpperCase()
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name ?? ''} width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  }
  return (
    <div
      className="flex items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
    >
      {label}
    </div>
  )
}
