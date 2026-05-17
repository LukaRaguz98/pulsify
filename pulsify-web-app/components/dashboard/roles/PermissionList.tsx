'use client'

import { useMemo, useState } from 'react'
import { Search, AlertTriangle, ShieldAlert, ChevronDown, ChevronRight } from 'lucide-react'
import {
  PERMISSION_CATEGORIES,
  type PermissionDef,
  type PermissionDanger,
} from '@/lib/discord-permissions'

type Props = {
  /** Set of currently enabled permission keys. */
  selected: Set<string>
  onToggle: (key: string, next: boolean) => void
  disabled?: boolean
  /** Rendered to the right of the search input — used for the preset dropdown. */
  toolbarRight?: React.ReactNode
}

const DANGER_COLORS: Record<PermissionDanger, { fg: string; bg: string; border: string }> = {
  high: { fg: '#f87171', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.35)' },
  medium: { fg: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.35)' },
}

export function PermissionList({ selected, onToggle, disabled, toolbarRight }: Props) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const q = search.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return PERMISSION_CATEGORIES
    return PERMISSION_CATEGORIES
      .map((cat) => ({
        ...cat,
        permissions: cat.permissions.filter(
          (p) =>
            p.label.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.key.toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => cat.permissions.length > 0)
  }, [q])

  const adminEnabled = selected.has('ADMINISTRATOR')

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search permissions…"
            className="w-full rounded-lg border py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
        </div>
        {toolbarRight && <div className="shrink-0">{toolbarRight}</div>}
      </div>

      {adminEnabled && (
        <div
          className="mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: DANGER_COLORS.high.border, background: DANGER_COLORS.high.bg, color: DANGER_COLORS.high.fg }}
        >
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            <strong>Administrator</strong> grants every permission and bypasses channel overwrites.
            Members with this role can manage anything below the bot in the hierarchy.
          </span>
        </div>
      )}

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <p className="text-xs text-subtle px-1">No permissions match this search.</p>
        ) : (
          filtered.map((cat) => {
            const isCollapsed = collapsed.has(cat.key)
            return (
              <div
                key={cat.key}
                className="rounded-lg border overflow-hidden"
                style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setCollapsed((prev) => {
                      const next = new Set(prev)
                      if (next.has(cat.key)) next.delete(cat.key)
                      else next.add(cat.key)
                      return next
                    })
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left"
                  style={{ color: 'var(--text-2)' }}
                >
                  <span className="text-xs font-semibold uppercase tracking-wider">{cat.label}</span>
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
                {!isCollapsed && (
                  <div className="border-t" style={{ borderColor: 'var(--line-strong)' }}>
                    {cat.permissions.map((p) => (
                      <PermissionRow
                        key={p.key}
                        perm={p}
                        checked={selected.has(p.key)}
                        forcedOn={adminEnabled && p.key !== 'ADMINISTRATOR'}
                        disabled={disabled}
                        onToggle={(next) => onToggle(p.key, next)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function PermissionRow({
  perm,
  checked,
  forcedOn,
  disabled,
  onToggle,
}: {
  perm: PermissionDef
  checked: boolean
  forcedOn: boolean
  disabled?: boolean
  onToggle: (next: boolean) => void
}) {
  const visuallyChecked = forcedOn || checked
  const dangerStyle = perm.danger ? DANGER_COLORS[perm.danger] : null
  const interactionDisabled = disabled || forcedOn
  return (
    <div
      className="flex items-start gap-3 border-b px-3 py-2 transition-colors last:border-b-0"
      style={{
        borderColor: 'var(--line)',
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--panel) 60%, transparent)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">{perm.label}</span>
          {dangerStyle && (
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
              style={{ background: dangerStyle.bg, color: dangerStyle.fg, borderColor: dangerStyle.border }}
              title={`${perm.danger === 'high' ? 'High' : 'Elevated'} risk permission`}
            >
              <AlertTriangle size={9} />
              {perm.danger === 'high' ? 'High risk' : 'Elevated'}
            </span>
          )}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">{perm.description}</p>
        {forcedOn && (
          <p className="mt-1 text-[10px] text-subtle italic">
            Implied by Administrator
          </p>
        )}
      </div>
      {/* Sliding toggle matches the pattern used in App Design, Automations,
          and Notification Preferences so all bool controls feel the same. */}
      <button
        type="button"
        onClick={() => { if (!interactionDisabled) onToggle(!checked) }}
        disabled={interactionDisabled}
        aria-checked={visuallyChecked}
        role="switch"
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed"
        style={{
          background: visuallyChecked ? 'var(--p-1)' : 'var(--line-strong)',
          cursor: interactionDisabled ? 'not-allowed' : 'pointer',
        }}
      >
        <span
          className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: visuallyChecked ? 'translateX(16px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  )
}
