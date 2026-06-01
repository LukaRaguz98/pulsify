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

    let done = false
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal()
            break
          }
        }
      },
      // threshold 0 (not a ratio): a section taller than the viewport — common
      // on mobile where everything stacks — can never reach a 12%-visible ratio,
      // so a ratio threshold would leave it stuck at opacity:0. Firing as soon
      // as any part crosses into the (slightly inset) viewport reveals reliably
      // at every height. The -10% bottom inset gives the reveal a beat before it
      // hits the very edge.
      { threshold: 0, rootMargin: '0px 0px -10% 0px' },
    )

    function reveal() {
      if (done) return
      done = true
      setVisible(true)
      obs.disconnect()
    }

    // Anything already in OR above the viewport must be shown immediately.
    // This is the fix for the "section goes black after navigating away and
    // back": on a re-mount the scroll position is restored mid-page, so the
    // section the user was on (and everything above it) is already on screen
    // and should never wait for an intersection that won't fire.
    const inOrAboveViewport = () => el.getBoundingClientRect().top < window.innerHeight

    obs.observe(el)
    if (inOrAboveViewport()) reveal()
    // Re-check next frame to catch scroll restoration that lands just after mount.
    const raf = requestAnimationFrame(() => {
      if (inOrAboveViewport()) reveal()
    })
    // bfcache restore (browser back/forward): re-assert visibility.
    const onPageShow = () => {
      if (inOrAboveViewport()) reveal()
    }
    window.addEventListener('pageshow', onPageShow)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pageshow', onPageShow)
      obs.disconnect()
    }
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
