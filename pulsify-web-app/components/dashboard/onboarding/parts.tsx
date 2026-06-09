'use client'

// Shared UI primitives for the Onboarding & Welcome editor. Kept framework-light
// and styled with the CSS-variable design system so every section looks uniform.

import { Check } from 'lucide-react'
import { THEMES } from '@/lib/themes'
import { HelpTip } from '@/components/ui/help-tip'

export type ChannelOpt = { id: string; name: string; type: number }
export type RoleOpt = { id: string; name: string; color: number }
export type EventOpt = { id: string; name: string; scheduled_start_time: string; user_count: number }

/** Discord role colour int -> hex, falling back to the design-system muted tone. */
export function roleHex(color: number): string {
  if (!color) return 'var(--text-3)'
  return `#${color.toString(16).padStart(6, '0')}`
}

export function Labeled({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-foreground mb-1.5">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px]" style={{ color: 'var(--text-3)' }}>{hint}</span>}
    </label>
  )
}

const inputCls =
  'w-full rounded-lg border px-3 py-2 text-sm text-foreground outline-none transition-colors'
const inputStyle = { background: 'var(--bg-2)', borderColor: 'var(--line-strong)' } as const

export function TextInput({
  value, onChange, placeholder, maxLength,
}: { value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className={inputCls}
      style={inputStyle}
      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
    />
  )
}

export function TextArea({
  value, onChange, placeholder, rows = 3, maxLength,
}: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; maxLength?: number }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      maxLength={maxLength}
      className={`${inputCls} resize-none`}
      style={inputStyle}
      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
    />
  )
}

export function NumberInput({
  value, onChange, min = 0, max, step = 1,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const n = Number(e.target.value)
        onChange(Number.isFinite(n) ? n : 0)
      }}
      className={inputCls}
      style={inputStyle}
      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
    />
  )
}

export function ChannelSelect({
  value, onChange, channels, allowNone = true, nonePlaceholder = '— None —',
}: {
  value: string
  onChange: (v: string) => void
  channels: ChannelOpt[]
  allowNone?: boolean
  nonePlaceholder?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
      style={{ ...inputStyle, color: 'var(--text)' }}
    >
      {allowNone && <option value="">{nonePlaceholder}</option>}
      {channels.map((c) => (
        <option key={c.id} value={c.id}>#{c.name}</option>
      ))}
    </select>
  )
}

export function RoleSelect({
  value, onChange, roles, nonePlaceholder = '— Select a role —',
}: { value: string; onChange: (v: string) => void; roles: RoleOpt[]; nonePlaceholder?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
      style={{ ...inputStyle, color: 'var(--text)' }}
    >
      <option value="">{nonePlaceholder}</option>
      {roles.map((r) => (
        <option key={r.id} value={r.id}>@{r.name}</option>
      ))}
    </select>
  )
}

/** Chip multi-select for roles (used by completion rewards). */
export function RoleMultiSelect({
  selected, onToggle, roles,
}: { selected: string[]; onToggle: (id: string) => void; roles: RoleOpt[] }) {
  const set = new Set(selected)
  if (roles.length === 0) {
    return <p className="text-xs" style={{ color: 'var(--text-3)' }}>No assignable roles found.</p>
  }
  return (
    <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto p-0.5">
      {roles.map((r) => {
        const on = set.has(r.id)
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onToggle(r.id)}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition"
            style={{
              borderColor: on ? 'var(--p-1)' : 'var(--line-strong)',
              background: on ? 'color-mix(in srgb, var(--p-1) 15%, transparent)' : 'var(--bg-2)',
              color: on ? 'var(--text)' : 'var(--text-2)',
            }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: roleHex(r.color) }} />
            {r.name}
            {on && <Check size={11} />}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Accent-colour picker matching the app Preferences look: a swatch grid of the
 * preset theme accents plus a "Custom" swatch backed by a hidden colour input.
 * Bound to a single hex value (e.g. the welcome embed accent).
 */
export function AccentColorPicker({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const norm = (v: string) => v.trim().toLowerCase()
  const isPreset = THEMES.some((t) => norm(t.accent) === norm(value))
  const customActive = !isPreset
  const customDisplay = customActive ? (value || '#8b5cf6') : '#8b5cf6'

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Accent Color</p>
        <span
          className="rounded px-1.5 py-0.5 font-mono text-xs"
          style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
        >
          {value || '#8b5cf6'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
        {THEMES.map((t) => {
          const active = !customActive && norm(t.accent) === norm(value)
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
              <div
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
              <p className="text-xs font-medium leading-none text-foreground">{t.name}</p>
            </button>
          )
        })}

        <label
          title="Custom color"
          aria-label="Pick a custom accent color"
          className="group relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all duration-150"
          style={{
            background: customActive ? `${customDisplay}14` : 'var(--bg-2)',
            borderColor: customActive ? customDisplay : 'var(--line-strong)',
            boxShadow: customActive ? `0 0 0 1px ${customDisplay}40` : 'none',
          }}
        >
          <div
            className="h-8 w-8 rounded-full"
            style={{
              background: customActive
                ? `linear-gradient(135deg, ${customDisplay}cc, ${customDisplay})`
                : 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #ec4899, #f43f5e)',
              boxShadow: customActive ? `0 4px 12px -4px ${customDisplay}80` : '0 2px 6px -4px rgba(255,255,255,0.15)',
            }}
          />
          {customActive && (
            <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: customDisplay }}>
              <Check size={9} strokeWidth={3} color="white" />
            </span>
          )}
          <p className="text-xs font-medium leading-none text-foreground">Custom</p>
          <input
            type="color"
            value={customDisplay}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  )
}

export function Toggle({
  checked, onChange, disabled = false,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40"
      style={{ background: checked ? 'var(--p-1)' : 'var(--line-strong)' }}
    >
      <span
        className="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
        style={{ transform: checked ? 'translateX(20px)' : 'translateX(3px)' }}
      />
    </button>
  )
}

export function SubCard({
  title, desc, right, children, helpId,
}: { title: string; desc?: string; right?: React.ReactNode; children?: React.ReactNode; helpId?: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {title}
            {helpId && <HelpTip id={helpId} iconSize={14} />}
          </h4>
          {desc && <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>{desc}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}

/** Inline empty/disabled hint shown inside a section when its toggle is off. */
export function DisabledHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg border border-dashed px-4 py-6 text-center text-sm"
      style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
    >
      {children}
    </div>
  )
}
