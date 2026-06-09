'use client'

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Info, ArrowRight, ArrowLeft, X, Check, Sparkles } from 'lucide-react'
import { usePreferences } from '@/components/ThemeProvider'
import { cn } from '@/lib/utils'

/**
 * Guided dashboard tour — a spotlight walkthrough that introduces the key parts
 * of the dashboard to new users.
 *
 * Gated by the SAME `contextualHelp` preference as the ⓘ help markers: when the
 * user switches "Show Contextual Help" off in Preferences, the tour (and its
 * launcher) disappear, and it never auto-starts.
 *
 * - Auto-runs once on a desktop viewport (tracked via the `pulsify-dashboard-tour`
 *   cookie); afterwards it only opens from the sidebar "Take a tour" launcher.
 * - Steps target layout chrome via `[data-tour="…"]` selectors; a step whose
 *   target is missing/off-screen (e.g. the sidebar drawer on mobile) gracefully
 *   falls back to a centred card with a dimmed backdrop.
 * - The launcher dispatches a window event so it stays decoupled from the engine.
 */

export const TOUR_EVENT = 'pulsify:start-tour'
export type TourVariant = 'guild' | 'workspace'
const CARD_WIDTH = 320
const PAD = 8
const GAP = 12

const useIso = typeof window !== 'undefined' ? useLayoutEffect : useEffect

type Step = {
  /** CSS selector for the element to spotlight. Omit for a centred card. */
  target?: string
  title: string
  body: ReactNode
}

/** Accent-coloured inline ⓘ used in the closing step's copy. */
function InlineInfo() {
  return <Info size={13} className="inline-block align-[-2px]" style={{ color: 'var(--p-1)' }} />
}

/** Closing step shared by both variants — embeds the accent ⓘ inline. */
const FINISH_STEP: Step = {
  title: "You're all set",
  body: (
    <>
      One last thing: look for the <InlineInfo /> info icons next to titles and settings — hover
      (or tap) them for guidance on what each feature does, and each one tells you which plan it
      needs. Prefer a cleaner UI? Turn the help icons and this tour off anytime in Preferences →
      Guidance.
    </>
  ),
}

/** Guild dashboard tour. The ping step is only included when the live-latency
 *  chip is actually enabled in Preferences (otherwise it isn't on screen). */
function guildSteps(pingIndicator: boolean): Step[] {
  return [
    {
      title: 'Welcome to Pulsify',
      body: "This is your command center for managing your Discord server — analytics, moderation, automations, events and more, all in one place. Here's a quick 30-second tour of the essentials so you know where everything lives. You can skip it anytime and replay it whenever you like.",
    },
    // ── Left: the sidebar, top to bottom ──
    {
      target: '[data-tour="server-card"]',
      title: 'Your server',
      body: 'This card shows the server you’re managing. Click it any time to open the Server Profile — the bot’s permissions, core settings and server info.',
    },
    {
      target: '[data-tour="search"]',
      title: 'Jump anywhere fast',
      body: 'Press ⌘K (Ctrl+K) or click here to instantly search every page, setting and quick action — the fastest way to get around without hunting through menus.',
    },
    {
      target: '[data-tour="nav"]',
      title: 'Every module lives here',
      body: 'Features are grouped by category — Analytics, Community, Moderation and more. Click a category to expand it, then pick a module. Your current page is highlighted.',
    },
    {
      target: '[data-tour="workspaces"]',
      title: 'Manage multiple servers',
      body: 'Workspaces let you group several servers and run them with a shared team — roles, tasks, incidents and cross-server analytics. Open this to switch into the workspace view.',
    },
    {
      target: '[data-tour="profile"]',
      title: 'Your account',
      body: 'Manage your profile, switch servers or workspaces, and sign out from here at the bottom of the sidebar.',
    },
    // ── Right: the chrome, top to bottom ──
    {
      target: '[data-pulsify-bell="true"]',
      title: 'Live notifications',
      body: 'Real-time activity and alerts for your server land here — new tickets, flagged messages, milestones and more — so you never miss anything important.',
    },
    {
      target: '[data-tour="launcher"]',
      title: 'Replay this tour anytime',
      body: 'Lost? You can reopen this tour whenever you need a refresher — from the corner near your notifications on desktop, or the menu on mobile.',
    },
    ...(pingIndicator
      ? [{
          target: '[data-pulsify-ping="true"]',
          title: 'Connection health',
          body: 'This little chip shows the live latency between the Discord server and the Pulsify web app — a quick health check that the connection is responsive.',
        } as Step]
      : []),
    FINISH_STEP,
  ]
}

/** Workspace tour. No "Workspaces" step (you're already in one — there's no
 *  Workspaces button here). The ping step is included only when the latency chip
 *  is enabled in Preferences, same as the guild tour. */
function workspaceSteps(pingIndicator: boolean): Step[] {
  return [
    {
      title: 'Welcome to your workspace',
      body: "A workspace is a shared space for managing several servers with your team. Here's a quick tour of the tools you'll use to collaborate — you can skip it anytime and replay it whenever you like.",
    },
    {
      target: '[data-tour="workspace-switcher"]',
      title: 'Your workspace',
      body: 'See which workspace you’re in and switch between the workspaces you belong to from here.',
    },
    {
      target: '[data-tour="search"]',
      title: 'Jump anywhere fast',
      body: 'Press ⌘K (Ctrl+K) or click here to instantly search every workspace page and action — the fastest way to get around.',
    },
    {
      target: '[data-tour="nav"]',
      title: 'Your team tools',
      body: 'Everything for running the workspace lives here — servers, team & roles, tasks, incidents, shared notes and cross-server analytics.',
    },
    {
      target: '[data-tour="profile"]',
      title: 'Your account',
      body: 'Manage your profile, head back to your servers, and sign out from the bottom of the sidebar.',
    },
    // ── Right: the chrome, top to bottom ──
    {
      target: '[data-pulsify-bell="true"]',
      title: 'Live notifications',
      body: 'Activity across every server in the workspace lands here, so your whole team stays in the loop.',
    },
    {
      target: '[data-tour="launcher"]',
      title: 'Replay this tour anytime',
      body: 'Need a refresher? You can reopen this tour whenever you like — from the corner near your notifications on desktop, or the menu on mobile.',
    },
    ...(pingIndicator
      ? [{
          target: '[data-pulsify-ping="true"]',
          title: 'Connection health',
          body: 'This little chip shows the live latency between the Discord server and the Pulsify web app — a quick health check that the connection is responsive.',
        } as Step]
      : []),
    FINISH_STEP,
  ]
}

type Rect = { top: number; left: number; width: number; height: number }

function getRect(selector: string | undefined): Rect | null {
  if (!selector) return null
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  // Treat zero-size or off-screen targets (e.g. a closed mobile drawer) as
  // "no target" so the step falls back to a centred card.
  if (r.width === 0 || r.height === 0) return null
  if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export function DashboardTour({ variant = 'guild' }: { variant?: TourVariant }) {
  const { contextualHelp, pingIndicator } = usePreferences()
  const STEPS = useMemo(
    () => (variant === 'workspace' ? workspaceSteps(pingIndicator) : guildSteps(pingIndicator)),
    [variant, pingIndicator],
  )
  const cookieName = `pulsify-tour-${variant}`
  const [active, setActive] = useState(false)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null)

  const step = STEPS[index]

  const finish = useCallback((markDone: boolean) => {
    setActive(false)
    if (markDone) {
      document.cookie = `${cookieName}=done; path=/; max-age=31536000; SameSite=Lax`
    }
  }, [cookieName])

  const start = useCallback(() => {
    setIndex(0)
    setActive(true)
  }, [])

  // Launch from the sidebar button (decoupled via a window event).
  useEffect(() => {
    const onStart = () => start()
    window.addEventListener(TOUR_EVENT, onStart)
    return () => window.removeEventListener(TOUR_EVENT, onStart)
  }, [start])

  // Auto-run once, on desktop, when contextual help is enabled.
  useEffect(() => {
    if (!contextualHelp) return
    const done = document.cookie.split('; ').some((c) => c.startsWith(`${cookieName}=done`))
    if (done) return
    if (!window.matchMedia('(min-width: 1024px)').matches) return
    const t = setTimeout(() => start(), 700)
    return () => clearTimeout(t)
  }, [contextualHelp, start, cookieName])

  // Position the spotlight + card for the current step, and keep them pinned
  // to the target while scrolling/resizing.
  useIso(() => {
    if (!active) return
    const place = () => {
      const r = getRect(step?.target)
      setRect(r)
      const vw = window.innerWidth
      const vh = window.innerHeight
      const cw = cardRef.current?.offsetWidth ?? CARD_WIDTH
      const ch = cardRef.current?.offsetHeight ?? 180
      if (!r) {
        setCardPos({ top: Math.max(PAD, (vh - ch) / 2), left: Math.max(PAD, (vw - cw) / 2) })
        return
      }
      // Prefer below the target, flip above when there's no room.
      let top = r.top + r.height + GAP
      if (top + ch > vh - PAD && r.top - GAP - ch > PAD) top = r.top - GAP - ch
      top = Math.max(PAD, Math.min(top, vh - ch - PAD))
      let left = r.left + r.width / 2 - cw / 2
      left = Math.max(PAD, Math.min(left, vw - cw - PAD))
      setCardPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [active, index, step?.target])

  // Escape skips the tour.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(true) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, finish])

  if (!contextualHelp || !active || typeof document === 'undefined') return null

  const isLast = index === STEPS.length - 1
  const next = () => (isLast ? finish(true) : setIndex((i) => i + 1))
  const back = () => setIndex((i) => Math.max(0, i - 1))

  // role="region" (not "dialog"): globals.css hides the notification bell + ping
  // chip whenever `body:has([role="dialog"])`, which would blank out the bell
  // during the step that spotlights it.
  return createPortal(
    <div className="fixed inset-0 z-[300]" role="region" aria-label="Dashboard tour">
      {/* Backdrop. With a target, the dim comes from the spotlight's huge
          box-shadow so the target stays bright; without one, dim the whole
          screen here. A transparent layer still blocks page interaction. */}
      <div
        className="absolute inset-0"
        style={{ background: rect ? 'transparent' : 'rgba(0,0,0,0.55)' }}
        onClick={() => finish(true)}
      />

      {/* Spotlight cut-out around the target. */}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-xl"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
            outline: '2px solid var(--p-1)',
            outlineOffset: '2px',
            transition: 'all 0.25s ease',
          }}
        />
      )}

      {/* Step card. */}
      <div
        ref={cardRef}
        role="group"
        aria-label={step.title}
        aria-live="polite"
        className="tour-card absolute rounded-2xl border p-4 shadow-2xl"
        style={{
          top: cardPos?.top ?? -9999,
          left: cardPos?.left ?? -9999,
          width: CARD_WIDTH,
          maxWidth: 'calc(100vw - 16px)',
          background: 'var(--panel-2, var(--panel))',
          borderColor: 'var(--line-strong)',
          opacity: cardPos ? 1 : 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            <Sparkles size={15} />
          </span>
          <h3 className="flex-1 text-sm font-bold text-foreground">{step.title}</h3>
          <button
            type="button"
            onClick={() => finish(true)}
            aria-label="Close tour"
            className="rounded-md p-1 transition-colors hover:bg-[var(--bg-2)]"
            style={{ color: 'var(--text-3)' }}
          >
            <X size={15} />
          </button>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>{step.body}</p>

        <div className="mt-4 flex items-center gap-3">
          {/* Progress dots — flex-1 so they fill the row (pushing the buttons
              right) and wrap instead of squashing the buttons on a narrow card. */}
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === index ? 16 : 6,
                  background: i === index ? 'var(--p-1)' : 'var(--line-strong)',
                }}
              />
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {index > 0 && (
              <button
                type="button"
                onClick={back}
                className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              >
                <ArrowLeft size={12} /> Back
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition"
              style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
            >
              {isLast ? (<><Check size={12} /> Finish</>) : (<>Next <ArrowRight size={12} /></>)}
            </button>
          </div>
        </div>

        {index === 0 && (
          <button
            type="button"
            onClick={() => finish(true)}
            className="mt-2 w-full text-center text-[11px] transition-colors hover:underline"
            style={{ color: 'var(--text-3)' }}
          >
            Skip tour
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Floating "Take a tour" button in the top-right chrome, just below the
 * notification bell. **Desktop only** (`hidden lg:flex`) — on mobile the chrome
 * corners are taken (bell + ping) and the bottom is owned by the sticky SaveBar,
 * so the mobile launcher lives in the sidebar drawer instead (see TourMenuItem).
 * Hidden when contextual help is off, so the same Preferences toggle governs both
 * the ⓘ markers and the tour.
 *
 * z-index is deliberately BELOW the notification bell (bell wrapper = z-10, its
 * dropdown z-40 within): as a separate fixed sibling, an equal/higher z would
 * paint it over the open notification panel. It still sits above page content.
 */
export function TourLauncher() {
  const { contextualHelp } = usePreferences()
  if (!contextualHelp) return null
  return (
    <button
      type="button"
      data-tour="launcher"
      onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}
      title="Take a tour"
      aria-label="Take a guided tour"
      className={cn(
        'hidden lg:flex fixed z-[9] top-2 right-3 mt-[84px] mr-[40px] h-9 w-9 items-center justify-center',
        'rounded-md border bg-[var(--panel)] border-[var(--line-strong)] text-[var(--p-1)]',
        'transition-all duration-150 hover:bg-[var(--p-soft)] hover:border-[var(--p-1)]',
        'hover:-translate-y-0.5 hover:shadow-[0_4px_12px_-4px_var(--p-glow)] active:translate-y-0 active:shadow-none',
      )}
    >
      <Info size={18} />
    </button>
  )
}

/**
 * Mobile-only ("lg:hidden") "Take a tour" row for the sidebar drawer — the
 * floating launcher is desktop-only, and the mobile chrome/bottom is occupied
 * (bell, ping, sticky SaveBar). Lives in the drawer's footer where mobile users
 * look for utility actions. Same contextual-help gate; dispatches the same event.
 */
export function TourMenuItem() {
  const { contextualHelp } = usePreferences()
  if (!contextualHelp) return null
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}
      className="lg:hidden flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition hover:text-foreground"
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
    >
      <Info size={16} /> Take a tour
    </button>
  )
}
