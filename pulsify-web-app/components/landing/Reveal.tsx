'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Scroll-reveal wrapper. Fades + slides its children in the first time they
 * enter the viewport, giving a modern transition between landing sections.
 *
 * Falls back to immediately visible (without motion) when IntersectionObserver
 * is unavailable or motion is reduced — respects the app-wide
 * `data-animations="false"` toggle and the OS `prefers-reduced-motion` setting,
 * so content is never stuck hidden.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [motion, setMotion] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduced =
      document.documentElement.getAttribute('data-animations') === 'false' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Reveal instantly (next frame, to keep the update out of the effect body)
    // when motion is off or observers are unsupported.
    if (reduced || typeof IntersectionObserver === 'undefined') {
      const id = requestAnimationFrame(() => {
        setMotion(false)
        setVisible(true)
      })
      return () => cancelAnimationFrame(id)
    }

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            obs.disconnect()
            break
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const transition = motion
    ? `opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, transform 0.7s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`
    : 'none'

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(34px)',
        transition,
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </div>
  )
}
