'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { ThumbsUp, Flag, Pencil, Trash2, EyeOff, ShieldAlert, Loader2, Pin } from 'lucide-react'
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
  /** Operator-only: pin / unpin this entry to the landing showcase. */
  onFeature: (f: Feedback, next: boolean) => void
  /** True when 3 entries are already featured (blocks featuring a 4th). */
  atFeatureLimit: boolean
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
  onFeature,
  atFeatureLimit,
  busy,
}: FeedbackCardProps) {
  const canVote = signedIn && !f.isOwn

  // Uniform card height: the message is clamped to MAX_LINES and a "Read more"
  // toggle reveals the rest in place. The message box also reserves that height
  // so short reviews don't produce shorter cards — every collapsed card matches.
  const MAX_LINES = 6
  const msgRef = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)

  useEffect(() => {
    const el = msgRef.current
    if (!el) return
    // scrollHeight reflects the full text even while line-clamped, so this read
    // is valid in both the collapsed and expanded states.
    const measure = () => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 22
      setCanExpand(el.scrollHeight > lh * MAX_LINES + 2)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [f.message])

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
            {isOperator && f.featured && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
                title="Shown on the landing page"
              >
                <Pin size={9} fill="currentColor" /> Featured
              </span>
            )}
          </div>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {formatFeedbackDate(f.createdAt)}
          </p>
        </div>
        <StarRating value={f.rating} size={15} animate />
      </header>

      {/* Title — clamped to 2 lines with the height reserved, so a one-line and
          a two-line title still produce equal-height cards. */}
      <h3
        className="mt-4 text-base font-semibold text-foreground"
        style={{
          lineHeight: 1.35,
          minHeight: '2.7em',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {f.title}
      </h3>
      {/* Message — clamped to 6 lines (collapsed) with that height reserved. */}
      <p
        ref={msgRef}
        className="mt-1.5 text-sm"
        style={{
          color: 'var(--text-2)',
          lineHeight: 1.625,
          minHeight: `${1.625 * MAX_LINES}em`,
          ...(expanded
            ? {}
            : {
                display: '-webkit-box',
                WebkitLineClamp: MAX_LINES,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }),
        }}
      >
        {f.message}
      </p>
      {/* Toggle — the row height is reserved whether or not the button shows, so
          cards with and without "Read more" stay the same height. */}
      <div className="mt-1.5" style={{ minHeight: '1.25rem' }}>
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-semibold transition-colors hover:underline"
            style={{ color: 'var(--p-1)' }}
          >
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}
      </div>

      {/* Spacer pins the footer to the bottom when a row is stretched by an
          expanded sibling card. */}
      <div className="flex-1" />

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
          {/* Operator-only: feature this entry on the landing page (max 3). */}
          {isOperator && (
            <button
              type="button"
              disabled={busy || (atFeatureLimit && !f.featured)}
              onClick={() => onFeature(f, !f.featured)}
              title={
                f.featured
                  ? 'Featured on the landing page — click to remove'
                  : atFeatureLimit
                    ? 'Already featuring 3 reviews — unfeature one first'
                    : 'Feature on the landing page'
              }
              className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              style={
                f.featured
                  ? { borderColor: 'var(--p-1)', background: 'var(--p-soft)', color: 'var(--p-1)' }
                  : { borderColor: 'var(--line-strong)', color: 'var(--text-3)' }
              }
            >
              <Pin size={13} fill={f.featured ? 'currentColor' : 'none'} />
              <span className="hidden sm:inline">{f.featured ? 'Featured' : 'Feature'}</span>
            </button>
          )}

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
