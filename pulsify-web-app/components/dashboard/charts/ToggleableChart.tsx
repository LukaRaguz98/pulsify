'use client'

import { useState, type ReactNode } from 'react'
import { ChartCard } from './ChartCard'
import { TrendChart, type ChartSeries, type ChartKind } from './TrendChart'
import { ChartTypeToggle } from './ChartTypeToggle'

type Props = {
  title: string
  subtitle?: string
  icon?: ReactNode
  data: Record<string, unknown>[]
  series: ChartSeries[]
  xKey: string
  defaultKind?: ChartKind
  /**
   * Stable id the chosen chart kind is persisted under (localStorage). Defaults
   * to a slug of the title — unique across the app today, but pass an explicit
   * key if two charts ever share a title.
   */
  storageKey?: string
  height?: number
  xTickFormatter?: (value: string) => string
  yTickFormatter?: (value: number) => string
  tooltipValueFormatter?: (value: number, name: string) => string
  tooltipLabelFormatter?: (value: string) => string
  showLegend?: boolean
}

const STORAGE_PREFIX = 'pulsify:chart-kind:'

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// A ChartCard whose body can be switched between a line and a bar chart. The
// choice is remembered per chart (localStorage) so re-entering a view keeps the
// kind the user last picked instead of snapping back to the default.
export function ToggleableChart({
  title,
  subtitle,
  icon,
  defaultKind = 'line',
  storageKey,
  ...chartProps
}: Props) {
  const storageId = `${STORAGE_PREFIX}${storageKey ?? slugify(title)}`

  // Lazy init from localStorage. These charts mount client-side (behind a tab
  // or after their data loads), so reading here doesn't cause a hydration
  // mismatch; guard for window all the same.
  const [kind, setKindState] = useState<ChartKind>(() => {
    if (typeof window === 'undefined') return defaultKind
    try {
      const saved = window.localStorage.getItem(storageId)
      return saved === 'line' || saved === 'bar' ? saved : defaultKind
    } catch {
      return defaultKind
    }
  })

  function setKind(next: ChartKind) {
    setKindState(next)
    try {
      window.localStorage.setItem(storageId, next)
    } catch {
      /* storage unavailable (private mode / quota) — selection still applies for this session */
    }
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      icon={icon}
      action={<ChartTypeToggle value={kind} onChange={setKind} />}
    >
      <TrendChart kind={kind} {...chartProps} />
    </ChartCard>
  )
}
