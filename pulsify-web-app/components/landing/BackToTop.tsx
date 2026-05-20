'use client'

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'

/** Floating "scroll to top" button that fades in once the visitor has
 *  scrolled past the hero. */
export function BackToTop() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 700)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full text-white"
      style={{
        background: 'linear-gradient(180deg, var(--p-1), var(--p-2))',
        boxShadow: '0 8px 24px -6px var(--p-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
        opacity: show ? 1 : 0,
        transform: show ? 'translateY(0)' : 'translateY(12px)',
        pointerEvents: show ? 'auto' : 'none',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
      }}
    >
      <ArrowUp size={18} />
    </button>
  )
}
