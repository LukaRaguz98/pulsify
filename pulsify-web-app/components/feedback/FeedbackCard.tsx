'use client'

import Image from 'next/image'
import { useState } from 'react'
import { ThumbsUp, Flag, Pencil, Trash2, EyeOff, ShieldAlert, Loader2 } from 'lucide-react'
import {
  authorDisplayName,
  authorInitial,
  formatFeedbackDate,
  type Feedback,
} from '@/lib/feedback'
import { StarRating } from './StarRating'

/** Author avatar with a gradient initial fallback (handles deleted users). */
function AuthorAvatar({ f, size = 40 }: { f: Feedback; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (f.authorAvatar && !broken) {
    return (
      <Image
        src={f.authorAvatar}
        alt={authorDisplayName(f)}
        width={size}
        height={size}
        unoptimized
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full"
        style={{ height: size, width: size }}
      />
    )
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        height: size,
        width: size,
        fontSize: size * 0.4,
        background: 'linear-gradient(135deg, var(--p-1), var(--p-2))',
      }}
    >
      {authorInitial(f)}
    </div>
  )
}

export type FeedbackCardProps = {
  feedback: Feedback
  signedIn: boolean
  isOperator: boolean
  onVote: (f: Feedback) => void
  onReport: (f: Feedback) => void
  onEdit: (f: Feedback) => void
  onDelete: (f: Feedback) => void
  onModerate: (f: Feedback, status: 'hidden' | 'removed') => void
  /** Per-card pending flag, keyed by the caller, to disable buttons mid-request. */
  busy?: boolean
}

/** Full community feedback card: rating, content, helpful votes + moderation. */
export function FeedbackCard({
  feedback: f,
  signedIn,
  isOperator,
  onVote,
  onReport,
  onEdit,
  onDelete,
  onModerate,
  busy,
}: FeedbackCardProps) {
  const canVote = signedIn && !f.isOwn
  return (
    <article
      className="fb-card-in flex flex-col rounded-2xl border p-5"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <header className="flex items-start gap-3">
        <AuthorAvatar f={f} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{authorDisplayName(f)}</p>
            {f.isOwn && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
              >
                You
              </span>
            )}
          </div>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {formatFeedbackDate(f.createdAt)}
          </p>
        </div>
        <StarRating value={f.rating} size={15} animate />
      </header>

      <h3 className="mt-4 text-base font-semibold text-foreground">{f.title}</h3>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
        {f.message}
      </p>

      <footer className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canVote || busy}
          onClick={() => onVote(f)}
          title={
            !signedIn
              ? 'Sign in to vote'
              : f.isOwn
                ? "You can't vote on your own feedback"
                : f.hasVoted
                  ? 'Remove your vote'
                  : 'Mark as helpful'
          }
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            borderColor: f.hasVoted ? 'var(--p-1)' : 'var(--line-strong)',
            background: f.hasVoted ? 'var(--p-soft)' : 'transparent',
            color: f.hasVoted ? 'var(--p-1)' : 'var(--text-2)',
          }}
        >
          <ThumbsUp size={13} fill={f.hasVoted ? 'currentColor' : 'none'} />
          {f.voteCount}
          <span className="hidden sm:inline">Helpful</span>
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          {f.isOwn ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => onEdit(f)}
                className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              >
                <Pencil size={13} /> Edit
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDelete(f)}
                title="Delete your feedback"
                className="inline-flex items-center justify-center rounded-lg border p-1.5 transition-colors disabled:opacity-60"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--red, #f87171)' }}
              >
                <Trash2 size={13} />
              </button>
            </>
          ) : (
            signedIn && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onReport(f)}
                title="Report this feedback"
                className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
              >
                <Flag size={13} /> <span className="hidden sm:inline">Report</span>
              </button>
            )
          )}

          {isOperator && !f.isOwn && (
            <>
              {f.reportCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold"
                  style={{ background: 'color-mix(in srgb, #f87171 18%, transparent)', color: '#f87171' }}
                  title={`${f.reportCount} report${f.reportCount === 1 ? '' : 's'}`}
                >
                  <ShieldAlert size={13} /> {f.reportCount}
                </span>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => onModerate(f, 'hidden')}
                title="Hide from the public wall"
                className="inline-flex items-center justify-center rounded-lg border p-1.5 transition-colors disabled:opacity-60"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--amber)' }}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <EyeOff size={13} />}
              </button>
            </>
          )}
        </div>
      </footer>
    </article>
  )
}
