'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { ArrowRight, Quote, ThumbsUp } from 'lucide-react'
import { authorDisplayName, authorInitial, formatFeedbackDate, type Feedback } from '@/lib/feedback'
import { StarRating } from './StarRating'

/** Avatar with gracefully-degrading fallback for deleted/avatarless authors. */
function Avatar({ f }: { f: Feedback }) {
  const [broken, setBroken] = useState(false)
  if (f.authorAvatar && !broken) {
    return (
      <Image
        src={f.authorAvatar}
        alt={authorDisplayName(f)}
        width={40}
        height={40}
        unoptimized
        onError={() => setBroken(true)}
        className="h-10 w-10 shrink-0 rounded-full"
      />
    )
  }
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
      style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
    >
      {authorInitial(f)}
    </div>
  )
}

function FeedbackTestimonial({ f }: { f: Feedback }) {
  return (
    <div
      className="lp-card flex min-w-[85%] snap-center flex-col rounded-2xl border p-6 sm:min-w-0"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="flex items-center justify-between">
        <StarRating value={f.rating} size={15} animate />
        <Quote size={22} style={{ color: 'var(--p-soft)' }} fill="currentColor" />
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{f.title}</p>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
        “{f.message}”
      </p>
      <div className="mt-5 flex items-center gap-3">
        <Avatar f={f} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{authorDisplayName(f)}</p>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>{formatFeedbackDate(f.createdAt)}</p>
        </div>
        {f.voteCount > 0 && (
          <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--text-3)' }}>
            <ThumbsUp size={12} /> {f.voteCount}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Landing-page showcase of the top community feedback (PULSIFY-39). Renders a
 * responsive grid on desktop and a swipeable, snap-scrolling carousel on
 * mobile, plus CTAs into the full /feedback wall.
 */
export function CommunityFeedback({ items }: { items: Feedback[] }) {
  return (
    <>
      <div className="mt-12 -mx-6 flex snap-x snap-mandatory gap-5 overflow-x-auto px-6 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0">
        {items.map((f) => (
          <FeedbackTestimonial key={f.id} f={f} />
        ))}
      </div>

      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          href="/feedback"
          className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all"
          style={{
            background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
            boxShadow: '0 6px 20px -6px var(--p-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
          }}
        >
          Share your feedback
        </Link>
        <Link
          href="/feedback"
          className="inline-flex items-center gap-1.5 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-colors"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
        >
          Read all reviews
          <ArrowRight size={15} />
        </Link>
      </div>
    </>
  )
}
