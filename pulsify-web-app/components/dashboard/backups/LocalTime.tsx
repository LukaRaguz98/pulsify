'use client'

import { useEffect, useState } from 'react'

type Mode = 'date' | 'datetime' | 'relative'

/** Deterministic, locale- AND timezone-independent rendering for the first paint
 *  (fixed en-US + UTC) so the server HTML and the client's initial render agree —
 *  no hydration mismatch. */
function deterministic(iso: string, mode: Mode): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  if (mode === 'date') {
    return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
  }
  return d.toLocaleString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** The friendly value shown once mounted — in the visitor's own locale/timezone. */
function localized(iso: string, mode: Mode): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  if (mode === 'relative') {
    const diff = Date.now() - d.getTime()
    const mins = Math.round(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.round(hrs / 24)
    if (days < 7) return `${days}d ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  if (mode === 'date') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Renders a timestamp without tripping hydration: identical deterministic text
 *  on server + first client render, then the localized value after mount. */
export function LocalTime({ iso, mode = 'datetime' }: { iso: string | null; mode?: Mode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!iso) return <>—</>
  return <span suppressHydrationWarning>{mounted ? localized(iso, mode) : deterministic(iso, mode)}</span>
}
