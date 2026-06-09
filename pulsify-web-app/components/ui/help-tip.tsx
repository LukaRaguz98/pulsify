'use client'

import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Info, ExternalLink, Sparkles } from 'lucide-react'
import { usePreferences } from '@/components/ThemeProvider'
import { cn } from '@/lib/utils'
import { HELP_CONTENT, type HelpEntry } from '@/lib/help-content'
import { PLAN_LABELS, type Plan } from '@/lib/billing'

type Coords = { top: number; left: number; arrowLeft: number; placement: 'top' | 'bottom' }

type HelpTipProps = {
  /** Look up title/body/docHref from the central registry in lib/help-content. */
  id?: string
  /** Inline overrides (win over the registry entry when both are present). */
  title?: string
  body?: ReactNode
  /** Minimum plan tier shown as an accent badge. Falls back to the registry
   *  entry's plan, then 'free'. */
  plan?: Plan
  docHref?: string
  docLabel?: string
  /** Preferred side; auto-flips when there isn't room. Default "bottom". */
  side?: 'top' | 'bottom'
  iconSize?: number
  /** Accessible label for the trigger. Defaults to "Help: {title}". */
  label?: string
  className?: string
}

const POP_WIDTH = 288
const GAP = 8
const MARGIN = 8

// HelpTip renders server-side (it lives inside PageHeader/SectionCard), so use
// useLayoutEffect only on the client — otherwise React warns it does nothing on
// the server. Positioning still happens before paint in the browser, so the
// popover never flashes at a stale position.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * Contextual help marker: a small ⓘ icon that reveals a tooltip with guidance.
 *
 * - Globally toggled by the `contextualHelp` preference (renders nothing when off).
 * - Opens on hover/focus (desktop) and on tap/click (mobile) — click "pins" it.
 * - The popover is portalled to <body> so SectionCard's `overflow-hidden` (and
 *   other clipping ancestors) can't crop it; positioned with `position: fixed`.
 * - Closes on Escape, outside click, or pointer leaving both trigger + popover.
 */
export function HelpTip({
  id, title, body, plan, docHref, docLabel = 'Learn more', side = 'bottom', iconSize = 16, label, className,
}: HelpTipProps) {
  const { contextualHelp } = usePreferences()
  const entry: HelpEntry | undefined = id ? HELP_CONTENT[id] : undefined
  const resolvedTitle = title ?? entry?.title
  const resolvedBody = body ?? entry?.body
  const resolvedDoc = docHref ?? entry?.docHref
  const resolvedPlan: Plan = plan ?? entry?.plan ?? 'free'

  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<Coords | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reactId = useId()
  const popId = `help-${reactId}`

  const clearClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }, [])
  const openNow = useCallback(() => { clearClose(); setOpen(true) }, [clearClose])
  const closeSoon = useCallback(() => {
    clearClose()
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }, [clearClose])

  const reposition = useCallback(() => {
    const t = triggerRef.current
    if (!t) return
    const r = t.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pw = popRef.current?.offsetWidth ?? POP_WIDTH
    const ph = popRef.current?.offsetHeight ?? 120

    let placement: 'top' | 'bottom' = side
    if (placement === 'bottom' && r.bottom + GAP + ph > vh - MARGIN && r.top - GAP - ph > MARGIN) placement = 'top'
    if (placement === 'top' && r.top - GAP - ph < MARGIN && r.bottom + GAP + ph < vh - MARGIN) placement = 'bottom'

    const top = placement === 'bottom' ? r.bottom + GAP : r.top - GAP - ph
    const rawLeft = r.left + r.width / 2 - pw / 2
    const left = Math.max(MARGIN, Math.min(rawLeft, vw - pw - MARGIN))
    const arrowLeft = Math.max(12, Math.min(r.left + r.width / 2 - left, pw - 12))
    setCoords({ top, left, arrowLeft, placement })
  }, [side])

  // Measure + position once the popover is in the DOM, and keep it pinned to the
  // trigger while scrolling/resizing.
  useIsoLayoutEffect(() => {
    if (!open) return
    reposition()
    const onScroll = () => reposition()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, reposition])

  // Escape + outside-click dismissal.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus() } }
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || popRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  useEffect(() => () => clearClose(), [clearClose])

  if (!contextualHelp || !resolvedBody) return null

  const ariaLabel = label ?? (resolvedTitle ? `Help: ${resolvedTitle}` : 'More information')

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => (open ? setOpen(false) : openNow())}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') openNow() }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') closeSoon() }}
        onFocus={openNow}
        onBlur={closeSoon}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full align-middle transition-colors hover:bg-[var(--p-soft)]',
          className,
        )}
        style={{ color: 'var(--p-1)', background: open ? 'var(--p-soft)' : undefined, width: iconSize + 8, height: iconSize + 8 }}
      >
        <Info size={iconSize} strokeWidth={2.25} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popRef}
          id={popId}
          role="tooltip"
          onPointerEnter={(e) => { if (e.pointerType === 'mouse') clearClose() }}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') closeSoon() }}
          className="help-pop fixed z-[200] rounded-xl border p-3.5 shadow-xl"
          style={{
            top: coords?.top ?? -9999,
            left: coords?.left ?? -9999,
            width: POP_WIDTH,
            maxWidth: 'calc(100vw - 16px)',
            background: 'var(--panel-2, var(--panel))',
            borderColor: 'var(--line-strong)',
            opacity: coords ? 1 : 0,
            transformOrigin: coords?.placement === 'top' ? 'bottom center' : 'top center',
          }}
        >
          {coords && (
            <span
              aria-hidden
              className="absolute h-2.5 w-2.5 rotate-45 border"
              style={{
                left: coords.arrowLeft - 5,
                [coords.placement === 'bottom' ? 'top' : 'bottom']: -6,
                background: 'var(--panel-2, var(--panel))',
                borderColor: 'var(--line-strong)',
                borderTopColor: coords.placement === 'bottom' ? 'var(--line-strong)' : 'transparent',
                borderLeftColor: coords.placement === 'bottom' ? 'var(--line-strong)' : 'transparent',
                borderRightColor: coords.placement === 'top' ? 'var(--line-strong)' : 'transparent',
                borderBottomColor: coords.placement === 'top' ? 'var(--line-strong)' : 'transparent',
              }}
            />
          )}
          {resolvedTitle && (
            <p className="mb-1 text-sm font-semibold text-foreground">{resolvedTitle}</p>
          )}
          <div className="text-xs leading-relaxed [&_strong]:font-semibold [&_strong]:text-foreground [&_p+p]:mt-2" style={{ color: 'var(--text-2)' }}>
            {resolvedBody}
          </div>
          {/* Plan badge — every tooltip states the minimum tier, accent-coloured. */}
          <div
            className="mt-2.5 flex items-center gap-1.5 border-t pt-2.5 text-[11px]"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
          >
            <Sparkles size={12} style={{ color: 'var(--p-1)' }} />
            <span>Available on</span>
            <span className="font-bold uppercase tracking-wide" style={{ color: 'var(--p-1)' }}>
              {PLAN_LABELS[resolvedPlan]}
            </span>
            <span>{resolvedPlan === 'free' ? 'plan' : 'plan & above'}</span>
          </div>
          {resolvedDoc && (
            <a
              href={resolvedDoc}
              target={resolvedDoc.startsWith('http') ? '_blank' : undefined}
              rel="noopener noreferrer"
              className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium transition-colors hover:underline"
              style={{ color: 'var(--p-1)' }}
            >
              {docLabel}
              <ExternalLink size={11} />
            </a>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
