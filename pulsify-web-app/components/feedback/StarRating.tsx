'use client'

import { useState } from 'react'
import { Star } from 'lucide-react'

/**
 * Star rating used everywhere feedback is shown or entered (PULSIFY-39).
 *
 * - Read-only by default: renders `value` filled stars with a subtle pop-in
 *   animation (the `.fb-star` keyframes in globals.css, disabled automatically
 *   when data-animations="false").
 * - Interactive when `onChange` is passed: hover previews, click commits, and
 *   it's keyboard-operable (arrow keys / 1-5) for accessibility.
 */
export function StarRating({
  value,
  onChange,
  size = 16,
  animate = false,
  className,
}: {
  value: number
  onChange?: (next: number) => void
  size?: number
  /** Pop-in the filled stars on mount (used on cards as they reveal). */
  animate?: boolean
  className?: string
}) {
  const [hover, setHover] = useState(0)
  const interactive = typeof onChange === 'function'
  const shown = hover || value

  return (
    <div
      className={`inline-flex items-center gap-0.5 ${className ?? ''}`}
      role={interactive ? 'radiogroup' : 'img'}
      aria-label={interactive ? 'Rate from 1 to 5 stars' : `Rated ${value} out of 5 stars`}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault()
                onChange!(Math.min(5, (value || 0) + 1))
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault()
                onChange!(Math.max(1, (value || 1) - 1))
              } else if (/^[1-5]$/.test(e.key)) {
                onChange!(Number(e.key))
              }
            }
          : undefined
      }
      tabIndex={interactive ? 0 : undefined}
    >
      {Array.from({ length: 5 }).map((_, i) => {
        const filled = i < shown
        const star = (
          <Star
            size={size}
            fill={filled ? 'currentColor' : 'none'}
            className={animate && filled ? 'fb-star' : undefined}
            style={animate && filled ? { animationDelay: `${i * 60}ms` } : undefined}
          />
        )
        if (!interactive) {
          return (
            <span key={i} style={{ color: filled ? 'var(--amber)' : 'var(--line-strong)' }}>
              {star}
            </span>
          )
        }
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i + 1}
            aria-label={`${i + 1} star${i ? 's' : ''}`}
            className="cursor-pointer rounded-sm p-0.5 transition-transform hover:scale-110 active:scale-95"
            style={{ color: filled ? 'var(--amber)' : 'var(--line-strong)' }}
            onMouseEnter={() => setHover(i + 1)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange!(i + 1)}
          >
            {star}
          </button>
        )
      })}
    </div>
  )
}
