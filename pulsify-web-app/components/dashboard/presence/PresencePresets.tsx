'use client'

import { PRESENCE_PRESETS, type PresencePreset } from '@/lib/presence'
import { PresenceIcon } from './icons'

type Props = {
  disabled?: boolean
  onApply: (preset: PresencePreset) => void
}

/**
 * Quick-apply preset buttons. Each fills the editor with a ready-made starting
 * point (branding, Pulse Guard, community, live event, maintenance). The user
 * still saves explicitly, so a misclick is harmless.
 */
export function PresencePresets({ disabled, onApply }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {PRESENCE_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          disabled={disabled}
          onClick={() => onApply(preset)}
          title={preset.description}
          className="flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all disabled:opacity-50"
          style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
          onMouseEnter={(e) => {
            if (!disabled) e.currentTarget.style.borderColor = 'var(--p-1)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--line-strong)'
          }}
        >
          <span
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            <PresenceIcon name={preset.icon} size={15} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{preset.label}</span>
            <span className="block text-[11px] leading-tight" style={{ color: 'var(--text-3)' }}>
              {preset.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
