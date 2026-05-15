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
  height?: number
  xTickFormatter?: (value: string) => string
  yTickFormatter?: (value: number) => string
  tooltipValueFormatter?: (value: number, name: string) => string
  tooltipLabelFormatter?: (value: string) => string
  showLegend?: boolean
}

// A ChartCard whose body can be switched between a line and a bar chart.
export function ToggleableChart({
  title,
  subtitle,
  icon,
  defaultKind = 'line',
  ...chartProps
}: Props) {
  const [kind, setKind] = useState<ChartKind>(defaultKind)
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
