'use client'

import { TIMEFRAMES, type Timeframe } from '@/lib/analytics'

type Props = {
  value: Timeframe
  onChange: (tf: Timeframe) => void
  disabled?: boolean
}

export function TimeframeFilter({ value, onChange, disabled }: Props) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-lg border p-0.5"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      {TIMEFRAMES.map((tf) => {
        const active = tf.value === value
        return (
          <button
            key={tf.value}
            onClick={() => onChange(tf.value)}
            disabled={disabled}
            className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
            style={
              active
                ? { background: 'var(--p-soft)', color: 'var(--p-1)' }
                : { color: 'var(--text-3)' }
            }
          >
            {tf.label}
          </button>
        )
      })}
    </div>
  )
}
