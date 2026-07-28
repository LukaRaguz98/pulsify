'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Mic, Radio } from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { LiveDot } from '@/components/dashboard/gaming/gaming-style'
import { displayName, formatDuration, type LiveSession } from '@/lib/gaming'

/**
 * Live gaming activity.
 *
 * TWO CLOCKS, DELIBERATELY. The list of who is playing is refetched every
 * POLL_MS; the duration on each card ticks locally every second from
 * `startedAt`. If the elapsed time came from the server it would freeze between
 * polls and then jump — the one thing a "live" panel must not do.
 *
 * Polling pauses while the tab is hidden. A dashboard left open in a background
 * tab overnight would otherwise make several thousand pointless requests.
 */

const POLL_MS = 20_000

export function GamingLive({ guildId }: { guildId: string }) {
  const [live, setLive] = useState<LiveSession[] | null>(null)
  const [anonymise, setAnonymise] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // The clock the elapsed counters are measured against. Held in state rather
  // than read during render: calling Date.now() while rendering makes the
  // component impure, and React (and this project's lint rules) reject it.
  // It starts null and is set from the fetch callback, so the first paint uses
  // the server's own `fetchedAt` instead of guessing.
  const [now, setNow] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/guilds/${guildId}/gaming/live`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Live activity could not be loaded.')
      setLive(body.live as LiveSession[])
      setAnonymise(Boolean(body.anonymise))
      setEnabled(Boolean(body.enabled))
      setNow(Date.now())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Live activity could not be loaded.')
    }
  }, [guildId])

  useEffect(() => {
    let cancelled = false

    // Defined inline so every setState below is reached through an await —
    // the effect body itself never updates state synchronously.
    const poll = async () => {
      if (cancelled) return
      await load()
    }

    const start = () => {
      if (timer.current) clearInterval(timer.current)
      timer.current = setInterval(() => void poll(), POLL_MS)
    }
    const stop = () => {
      if (timer.current) clearInterval(timer.current)
      timer.current = null
    }

    const onVisibility = () => {
      if (document.hidden) stop()
      else {
        void poll()
        start()
      }
    }

    void poll()
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  // The local ticker for the elapsed counters. setState inside an interval
  // callback is a subscription to an external system, which is exactly what
  // effects are for.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (error) {
    return (
      <EmptyState
        icon={<Activity size={18} />}
        title="Couldn't load live activity"
        description={error}
        variant="muted"
      />
    )
  }

  if (!live) return <TableSkeleton rows={4} columns={3} />

  if (!enabled) {
    return (
      <EmptyState
        icon={<Activity size={18} />}
        title="Gaming tracking is off"
        description="Live activity needs tracking switched on — nothing is being recorded right now."
      />
    )
  }

  if (live.length === 0) {
    return (
      <EmptyState
        icon={<Activity size={18} />}
        title="Nobody is playing right now"
        description="This panel updates itself — as soon as someone starts a game, their card appears here."
        variant="muted"
      />
    )
  }

  return (
    <CategorySection
      icon={<LiveDot />}
      title={`Playing right now — ${live.length}`}
      description="Updates automatically. Durations count up live."
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {live.map((s, i) => {
          const started = Date.parse(s.startedAt)
          const elapsed = now == null ? 0 : Math.max(0, (now - started) / 1000)
          return (
            <div
              key={s.id}
              className="rounded-xl border p-4"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">
                    {displayName({ userId: s.userId, userName: s.userName }, anonymise, i + 1)}
                  </p>
                  <p className="mt-0.5 truncate text-sm" style={{ color: 'var(--text-2)' }}>
                    {s.gameName}
                  </p>
                </div>
                <LiveDot />
              </div>

              <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
                {formatDuration(elapsed)}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                started {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>

              {(s.wasStreaming || s.voiceChannelName) && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.wasStreaming && (
                    <span
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: 'rgba(168,85,247,0.12)', color: '#a855f7' }}
                    >
                      <Radio size={10} />
                      streaming
                    </span>
                  )}
                  {s.voiceChannelName && (
                    <span
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}
                    >
                      <Mic size={10} />
                      {s.voiceChannelName}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </CategorySection>
  )
}
