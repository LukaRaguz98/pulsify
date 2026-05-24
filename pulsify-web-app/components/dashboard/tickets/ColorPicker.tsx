'use client'

import { Check } from 'lucide-react'
import { THEMES } from '@/lib/themes'

type Props = {
  value: string
  onChange: (hex: string) => void
  /** Compact circle row (for inline use) instead of the full card grid. */
  compact?: boolean
}

/**
 * Accent colour picker that mirrors the app-design (Preferences › Accent Colour)
 * selector: the preset theme swatches plus a Custom swatch backed by a native
 * colour input. Used for ticket colours so they're chosen the same way the rest
 * of the app's accent is.
 */
export function ColorPicker({ value, onChange, compact }: Props) {
  const norm = value.toLowerCase()
  const matchesPreset = THEMES.some((t) => t.accent.toLowerCase() === norm)

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {THEMES.map((t) => {
          const active = t.accent.toLowerCase() === norm
          return (
            <button
              key={t.id}
              type="button"
              title={t.name}
              onClick={() => onChange(t.accent)}
              className="relative h-7 w-7 rounded-full transition-transform"
              style={{
                background: `linear-gradient(135deg, ${t.accent}cc, ${t.accent})`,
                boxShadow: active ? `0 0 0 2px var(--panel), 0 0 0 4px ${t.accent}` : 'none',
              }}
            >
              {active && (
                <Check size={12} strokeWidth={3} color="white" className="absolute inset-0 m-auto" />
              )}
            </button>
          )
        })}
        <label
          title="Custom colour"
          className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full"
          style={{
            background: !matchesPreset ? `linear-gradient(135deg, ${value}cc, ${value})` : 'conic-gradient(red, orange, yellow, lime, cyan, blue, magenta, red)',
            boxShadow: !matchesPreset ? `0 0 0 2px var(--panel), 0 0 0 4px ${value}` : 'none',
          }}
        >
          {!matchesPreset && <Check size={12} strokeWidth={3} color="white" />}
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </label>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-8">
      {THEMES.map((t) => {
        const active = t.accent.toLowerCase() === norm
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.accent)}
            title={t.name}
            className="group relative flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all duration-150"
            style={{
              background: active ? `${t.accent}14` : 'var(--bg-2)',
              borderColor: active ? t.accent : 'var(--line-strong)',
              boxShadow: active ? `0 0 0 1px ${t.accent}40` : 'none',
            }}
          >
            <span
              className="h-8 w-8 rounded-full"
              style={{
                background: `linear-gradient(135deg, ${t.accent}cc, ${t.accent})`,
                boxShadow: active ? `0 4px 12px -4px ${t.accent}80` : `0 2px 6px -4px ${t.accent}60`,
              }}
            />
            {active && (
              <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: t.accent }}>
                <Check size={9} strokeWidth={3} color="white" />
              </span>
            )}
            <p className="text-[11px] font-medium leading-none text-foreground">{t.name}</p>
          </button>
        )
      })}

      {/* Custom — active when the value sits outside the preset palette. */}
      {(() => {
        const customActive = !matchesPreset
        return (
          <label
            title="Custom colour"
            aria-label="Pick a custom accent colour"
            className="group relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all duration-150"
            style={{
              background: customActive ? `${value}14` : 'var(--bg-2)',
              borderColor: customActive ? value : 'var(--line-strong)',
              boxShadow: customActive ? `0 0 0 1px ${value}40` : 'none',
            }}
          >
            <span
              className="h-8 w-8 rounded-full"
              style={{
                background: customActive
                  ? `linear-gradient(135deg, ${value}cc, ${value})`
                  : 'conic-gradient(red, orange, yellow, lime, cyan, blue, magenta, red)',
              }}
            />
            {customActive && (
              <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: value }}>
                <Check size={9} strokeWidth={3} color="white" />
              </span>
            )}
            <p className="text-[11px] font-medium leading-none text-foreground">Custom</p>
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        )
      })()}
    </div>
  )
}
