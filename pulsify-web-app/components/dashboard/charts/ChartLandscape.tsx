'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { RotateCw, X } from 'lucide-react'

type Props = {
  /** Heading shown in the forced-landscape overlay. */
  title: string
  /** Min height of the portrait placeholder, matched to the chart height so the
   *  card doesn't jump in size when the orientation flips. */
  minHeight?: number
  /** The chart to render (inline in landscape, or inside the overlay). */
  children: ReactNode
}

// A mobile phone held upright matches this; landscape and any >=lg viewport
// (desktop) do not, so the chart renders inline there.
const PORTRAIT_QUERY = '(max-width: 1023px) and (orientation: portrait)'

/**
 * Orientation-aware chart host (mobile only).
 *
 * A wide time-series chart is unreadable in a ~340px portrait column, and we
 * don't want it forcing sideways scrolling. So in **portrait on a phone** the
 * chart is replaced by a same-width placeholder telling the user it's best in
 * landscape, with a button that opens a full-screen, CSS-rotated view (this
 * also covers users whose device rotation-lock is on, since the Screen
 * Orientation lock API isn't available on iOS Safari). In **landscape** — or on
 * desktop — the chart simply renders inline with all the room it needs.
 */
export function ChartLandscape({ title, minHeight = 220, children }: Props) {
  const [portrait, setPortrait] = useState(false)
  const [open, setOpen] = useState(false)

  // Track portrait-phone orientation live so rotating the device swaps between
  // the placeholder and the inline chart without a reload.
  useEffect(() => {
    const mq = window.matchMedia(PORTRAIT_QUERY)
    const update = () => setPortrait(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // If the user physically rotates to landscape while the forced view is open,
  // close it — the inline chart takes over.
  useEffect(() => {
    if (!portrait && open) setOpen(false)
  }, [portrait, open])

  // Body scroll lock + Escape-to-close while the overlay is up.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Landscape or desktop: the chart has room — render it inline.
  if (!portrait) return <>{children}</>

  // Portrait phone: keep the card the same width as everything else (no sideways
  // scrolling) and offer the landscape view.
  return (
    <>
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center"
        style={{ minHeight, borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
      >
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
        >
          <RotateCw size={18} />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">Best viewed in landscape</p>
          <p className="mt-0.5 text-xs text-subtle">
            Rotate your device, or open a landscape view of this chart.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border px-3 py-1.5 text-sm font-medium transition"
          style={{ borderColor: 'var(--p-1)', background: 'var(--p-soft)', color: 'var(--p-1)' }}
        >
          View in landscape
        </button>
      </div>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[70]" style={{ background: 'var(--bg)' }}>
            {/* Origin at the screen's top-right corner + rotate(90deg) makes a
                box of width=100dvh × height=100dvw cover the portrait viewport
                sideways, so the chart fills the device's long edge. */}
            <div
              className="absolute flex flex-col"
              style={{
                top: 0,
                left: '100dvw',
                width: '100dvh',
                height: '100dvw',
                transformOrigin: '0 0',
                transform: 'rotate(90deg)',
              }}
            >
              <div
                className="flex shrink-0 items-center justify-between border-b px-4 py-3"
                style={{ borderColor: 'var(--line-strong)' }}
              >
                <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close landscape view"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition hover:bg-[var(--bg-2)]"
                  style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 items-center p-4">
                <div className="w-full">{children}</div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
