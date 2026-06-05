'use client'

import { useEffect, useState } from 'react'
import { X, Loader2, Send } from 'lucide-react'
import { FEEDBACK_LIMITS, validateFeedback, type Feedback, type FeedbackInput } from '@/lib/feedback'
import { StarRating } from './StarRating'

/**
 * Create / edit feedback in a modal. Controlled entirely by the parent
 * (FeedbackExplorer): `editing` seeds the fields for an edit, null = create.
 * Validation mirrors lib/feedback.ts so the submit button reflects the same
 * rules the server enforces.
 */
export function FeedbackForm({
  editing,
  onClose,
  onSubmit,
}: {
  editing: Feedback | null
  onClose: () => void
  onSubmit: (input: FeedbackInput) => Promise<{ ok: boolean; error?: string }>
}) {
  const [title, setTitle] = useState(editing?.title ?? '')
  const [message, setMessage] = useState(editing?.message ?? '')
  const [rating, setRating] = useState(editing?.rating ?? 5)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Close on Escape — standard modal affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !pending && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pending])

  const valid = validateFeedback({ title, message, rating })

  const submit = async () => {
    if (!valid.ok) {
      setError(valid.error)
      return
    }
    setError(null)
    setPending(true)
    const res = await onSubmit(valid.value)
    setPending(false)
    if (!res.ok) setError(res.error ?? 'Something went wrong.')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      style={{ background: 'color-mix(in srgb, black 55%, transparent)' }}
      onClick={() => !pending && onClose()}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-t-2xl border sm:rounded-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: 'var(--line-strong)' }}
        >
          <h2 className="text-base font-semibold text-foreground">
            {editing ? 'Edit your feedback' : 'Share your feedback'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-2)] disabled:opacity-50"
            style={{ color: 'var(--text-3)' }}
          >
            <X size={18} />
          </button>
        </header>

        <div className="space-y-4 px-5 py-5">
          {/* Rating */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              Your rating
            </label>
            <StarRating value={rating} onChange={setRating} size={28} />
          </div>

          {/* Title */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="fb-title" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                Title
              </label>
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {title.length}/{FEEDBACK_LIMITS.titleMax}
              </span>
            </div>
            <input
              id="fb-title"
              value={title}
              maxLength={FEEDBACK_LIMITS.titleMax}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sum it up in a few words"
              className="w-full rounded-xl border bg-transparent px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-[var(--p-1)]"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
            />
          </div>

          {/* Message */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="fb-message" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                Your feedback
              </label>
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {message.length}/{FEEDBACK_LIMITS.messageMax}
              </span>
            </div>
            <textarea
              id="fb-message"
              value={message}
              maxLength={FEEDBACK_LIMITS.messageMax}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="What do you love about Pulsify? What could be better?"
              className="w-full resize-none rounded-xl border bg-transparent px-3.5 py-2.5 text-sm leading-relaxed text-foreground outline-none transition-colors focus:border-[var(--p-1)]"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
            />
          </div>

          {error && (
            <p
              className="rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: 'color-mix(in srgb, #f87171 40%, transparent)', background: 'color-mix(in srgb, #f87171 12%, transparent)', color: '#f87171' }}
            >
              {error}
            </p>
          )}
        </div>

        <footer
          className="flex items-center justify-end gap-2 border-t px-5 py-4"
          style={{ borderColor: 'var(--line-strong)' }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-xl border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !valid.ok}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
              boxShadow: '0 6px 20px -6px var(--p-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
            }}
          >
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {editing ? 'Save changes' : 'Submit feedback'}
          </button>
        </footer>
      </div>
    </div>
  )
}
