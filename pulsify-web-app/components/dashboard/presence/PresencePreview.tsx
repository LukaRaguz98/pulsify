'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import {
  STATUS_OPTIONS,
  formatActivityLine,
  MAINTENANCE_DEFAULT_TEXT,
  type PresenceDraft,
  type PresenceVars,
} from '@/lib/presence'

type Props = {
  draft: PresenceDraft
  vars: Partial<PresenceVars>
  botName?: string
}

/**
 * Live, animated preview of what Pulse's Discord presence will look like.
 * Mirrors a Discord member-list / profile row: avatar with a status dot, the
 * bot name, and the current activity line with placeholders resolved against
 * live values. When rotation is on it cycles through the activities at the
 * configured interval so the preview "feels" like the real rotating presence.
 */
export function PresencePreview({ draft, vars, botName = 'Pulse' }: Props) {
  const [index, setIndex] = useState(0)

  const maintenance = draft.maintenanceMode
  const status = maintenance ? 'dnd' : draft.status
  const dotColor = STATUS_OPTIONS.find((s) => s.value === status)?.color ?? '#23a55a'

  // Rotation: advance the index on the configured interval. Reset whenever the
  // list length or interval changes so the preview never points off the end.
  const count = draft.activities.length
  const intervalMs = Math.max(2000, draft.rotationIntervalSeconds * 1000)
  useEffect(() => {
    setIndex(0)
    if (maintenance || !draft.rotationEnabled || count <= 1) return
    const id = setInterval(() => setIndex((i) => (i + 1) % count), intervalMs)
    return () => clearInterval(id)
  }, [maintenance, draft.rotationEnabled, count, intervalMs])

  let line: string
  if (maintenance) {
    line = draft.maintenanceText || MAINTENANCE_DEFAULT_TEXT
  } else if (count === 0) {
    line = 'Powered by Pulsify'
  } else {
    const safeIdx = index % count
    line = formatActivityLine(draft.activities[safeIdx], vars)
  }

  return (
    <div
      className="rounded-2xl border p-4"
      style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
    >
      <div className="flex items-center gap-3">
        {/* Avatar + status dot */}
        <div className="relative shrink-0">
          <div
            className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
          >
            <Image src="/logo.png" alt="Pulse" width={30} height={30} className="shrink-0" />
          </div>
          <span
            className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-[3px]"
            style={{ background: dotColor, borderColor: 'var(--bg-2)' }}
            aria-hidden
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
            {botName}
            <span
              className="rounded px-1 py-0.5 text-[9px] font-bold uppercase leading-none text-white"
              style={{ background: 'var(--p-1)' }}
            >
              App
            </span>
          </p>
          {/* The activity line. A key on the text drives a soft fade as it
              rotates, giving the "animated preview card" feel. */}
          <p
            key={line}
            className="truncate text-xs animate-in fade-in slide-in-from-bottom-1"
            style={{ color: 'var(--text-2)' }}
          >
            {line}
          </p>
        </div>
      </div>

      {/* Rotation ticks — a small row of dots indicating position in the
          rotation, so the preview reads as a cycle even between transitions. */}
      {!maintenance && draft.rotationEnabled && count > 1 && (
        <div className="mt-3 flex items-center gap-1.5">
          {draft.activities.map((_, i) => (
            <span
              key={i}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === index % count ? '16px' : '6px',
                background: i === index % count ? 'var(--p-1)' : 'var(--line-strong)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
