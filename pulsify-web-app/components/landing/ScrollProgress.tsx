'use client'

import { useEffect, useState } from 'react'

/** Thin gradient bar pinned to the top of the viewport that fills as the
 *  visitor scrolls — a small, modern reading-progress affordance. */
export function ScrollProgress() {
  const [pct, setPct] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setPct(max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <div className="fixed inset-x-0 top-0 z-50 h-0.5" aria-hidden>
      <div
        className="h-full"
        style={{
          width: `${pct}%`,
          background: 'linear-gradient(90deg, var(--p-1), var(--cyan))',
          boxShadow: '0 0 10px var(--p-glow)',
          transition: 'width 0.1s linear',
        }}
      />
    </div>
  )
}
