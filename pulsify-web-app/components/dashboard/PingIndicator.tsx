'use client'

import { useEffect, useState } from 'react'
import { usePreferences } from '@/components/ThemeProvider'

const POLL_MS = 10_000
// Thresholds (ms) chosen to roughly track Discord's own published latency
// buckets: green = healthy, yellow = degraded, red = poor / likely impacting
// dashboard actions (Discord client itself starts complaining around 500ms).
const STABLE_MS = 200
const DEGRADED_MS = 500

type Status = 'stable' | 'degraded' | 'poor' | 'unknown'

function classify(latency: number | null): Status {
  if (latency === null) return 'unknown'
  if (latency < STABLE_MS) return 'stable'
  if (latency < DEGRADED_MS) return 'degraded'
  return 'poor'
}

const STATUS_COLORS: Record<Status, string> = {
  stable: '#10b981',
  degraded: '#f59e0b',
  poor: '#ef4444',
  unknown: 'var(--text-3)',
}

const STATUS_LABELS: Record<Status, string> = {
  stable: 'Stable connection to Discord',
  degraded: 'Degraded connection to Discord',
  poor: 'Poor connection to Discord',
  unknown: 'Discord latency unknown',
}

/**
 * Live latency chip pinned to the bottom-right corner. Polls
 * /api/discord/ping every 10 s, colour-codes the dot by latency bucket,
 * and prints the raw ms value. Hides behind dialogs via the shared
 * `data-pulsify-*` :has() rule in globals.css.
 */
export function PingIndicator() {
  const { pingIndicator } = usePreferences()
  const [latency, setLatency] = useState<number | null>(null)

  // Skip the poll entirely when the user has the chip turned off — no point
  // spending a Discord round-trip every 10s if nothing's going to render.
  useEffect(() => {
    if (!pingIndicator) return
    let cancelled = false
    async function poll() {
      try {
        const res = await fetch('/api/discord/ping', { cache: 'no-store' })
        if (cancelled) return
        if (!res.ok) {
          setLatency(null)
          return
        }
        const data = (await res.json()) as { latency: number | null; ok: boolean }
        setLatency(typeof data.latency === 'number' ? data.latency : null)
      } catch {
        if (!cancelled) setLatency(null)
      }
    }
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [pingIndicator])

  if (!pingIndicator) return null

  const status = classify(latency)
  const color = STATUS_COLORS[status]
  const label = latency === null ? '—' : `${latency}ms`

  return (
    <div
      data-pulsify-ping="true"
      className="fixed z-0 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-mono"
      style={{
        // Mirror Discord-icon offsets on the opposite side so both bottom-row
        // chrome elements sit at the same baseline (48px) and 52px in from
        // their respective edges.
        bottom: '48px',
        right: '52px',
        background: 'var(--panel)',
        borderColor: 'var(--line-strong)',
        color: 'var(--text-2)',
      }}
      title={`${STATUS_LABELS[status]} — ${label}`}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{
          background: color,
          boxShadow: status === 'stable' ? `0 0 6px ${color}` : 'none',
          transition: 'background 0.3s ease, box-shadow 0.3s ease',
        }}
      />
      <span>{label}</span>
    </div>
  )
}
