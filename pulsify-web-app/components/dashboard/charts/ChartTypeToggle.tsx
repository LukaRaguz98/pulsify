'use client'

import { LineChart, BarChart3 } from 'lucide-react'
import type { ChartKind } from './TrendChart'

type Props = {
  value: ChartKind
  onChange: (kind: ChartKind) => void
}

const OPTIONS: { kind: ChartKind; Icon: typeof LineChart; label: string }[] = [
  { kind: 'line', Icon: LineChart, label: 'Line chart' },
  { kind: 'bar', Icon: BarChart3, label: 'Bar chart' },
]

export function ChartTypeToggle({ value, onChange }: Props) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-lg border p-0.5"
      style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
    >
      {OPTIONS.map(({ kind, Icon, label }) => {
        const active = value === kind
        return (
          <button
            key={kind}
            onClick={() => onChange(kind)}
            title={label}
            aria-label={label}
            className="flex items-center justify-center rounded-md p-1 transition-colors"
            style={
              active
                ? { background: 'var(--p-soft)', color: 'var(--p-1)' }
                : { color: 'var(--text-3)' }
            }
          >
            <Icon size={13} />
          </button>
        )
      })}
    </div>
  )
}
