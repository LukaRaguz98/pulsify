'use client'

// The shared "stage" behind every Pulse embed preview: an animated, theme-accent
// field (soft gradient + grid + slow-rotating sheen + rising motes) whose edges
// are feathered on all sides so it melts into the page with no border line. The
// content passed as `children` floats crisply on top. Styling lives in
// globals.css under the `.ob-stage*` / `.ob-field` / `.ob-particle` classes.

import type { ReactNode } from 'react'

// Precomputed rising-mote layout (fixed so the field is stable across renders,
// not reshuffled on every keystroke).
const PARTICLES = [
  { left: 12, dur: 9, delay: 0 },
  { left: 28, dur: 12, delay: 2.4 },
  { left: 44, dur: 10, delay: 4.1 },
  { left: 58, dur: 13, delay: 1.2 },
  { left: 71, dur: 8.5, delay: 3.3 },
  { left: 86, dur: 11.5, delay: 5.2 },
  { left: 36, dur: 14, delay: 6.5 },
  { left: 64, dur: 9.5, delay: 7.8 },
]

export function PreviewStage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="ob-stage-wrap">
      <div className={`ob-stage rounded-2xl px-6 pb-6 pt-0.5 sm:px-7 sm:pb-7 sm:pt-1 ${className ?? ''}`}>
        {/* All the animated background lives in its own layer that is feathered
            on every edge, so the field dissolves with no visible border line
            while the content above it stays perfectly crisp. */}
        <div className="ob-field" aria-hidden>
          <div className="ob-particles">
            {PARTICLES.map((p, i) => (
              <span
                key={i}
                className="ob-particle"
                style={{ left: `${p.left}%`, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }}
              />
            ))}
          </div>
        </div>

        {/* Content floats straight on the field — transparent, no card. */}
        <div className="relative">{children}</div>
      </div>
    </div>
  )
}
