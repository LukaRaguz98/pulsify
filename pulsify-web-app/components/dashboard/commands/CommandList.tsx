'use client'

import { useMemo, useState } from 'react'
import { Search, Loader2 } from 'lucide-react'
import {
  CATEGORY_META,
  commandStatus,
  effectiveCategory,
  effectivePermission,
  hasRestrictions,
  type CommandDefinition,
  type CommandConfig,
  type CommandCategory,
} from '@/lib/commands'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge, CategoryBadge, PermissionBadge, HiddenBadge } from './badges'

export type ResolvedCommand = { def: CommandDefinition; config: CommandConfig }

type StatusFilter = 'all' | 'enabled' | 'disabled' | 'maintenance' | 'hidden' | 'restricted'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'restricted', label: 'Restricted' },
]

type Props = {
  commands: ResolvedCommand[]
  usageByName: Record<string, number>
  busyNames: Set<string>
  onSelect: (name: string) => void
  onToggleEnabled: (name: string, enabled: boolean) => void
  onBulkSetEnabled: (names: string[], enabled: boolean) => void
}

export function CommandList({
  commands,
  usageByName,
  busyNames,
  onSelect,
  onToggleEnabled,
  onBulkSetEnabled,
}: Props) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<CommandCategory | 'all'>('all')
  const [status, setStatus] = useState<StatusFilter>('all')

  const categories = useMemo(() => {
    const set = new Set<CommandCategory>()
    for (const c of commands) set.add(effectiveCategory(c.def, c.config))
    return [...set]
  }, [commands])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return commands.filter(({ def, config }) => {
      if (q && !def.name.includes(q) && !def.description.toLowerCase().includes(q)) return false
      if (category !== 'all' && effectiveCategory(def, config) !== category) return false
      const st = commandStatus(config)
      switch (status) {
        case 'enabled':
          return st === 'enabled'
        case 'disabled':
          return st === 'disabled'
        case 'maintenance':
          return st === 'maintenance'
        case 'hidden':
          return config.hidden
        case 'restricted':
          return hasRestrictions(config)
        default:
          return true
      }
    })
  }, [commands, search, category, status])

  const filteredNames = filtered.map((c) => c.def.name)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-3)' }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search commands…"
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="rounded-lg border px-2.5 py-2 text-sm focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <CategoryChip active={category === 'all'} onClick={() => setCategory('all')}>
          All categories
        </CategoryChip>
        {categories.map((c) => (
          <CategoryChip key={c} active={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_META[c].label}
          </CategoryChip>
        ))}
      </div>

      {/* Bulk actions */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-subtle">
            {filtered.length} command{filtered.length === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onBulkSetEnabled(filteredNames, true)}
              className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition hover:bg-[var(--bg-2)]"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              Enable all
            </button>
            <button
              type="button"
              onClick={() => onBulkSetEnabled(filteredNames, false)}
              className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition hover:bg-[var(--bg-2)]"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              Disable all
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={28} />}
          title="No commands match"
          description="Try a different search term or clear the filters."
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map(({ def, config }) => {
            const status = commandStatus(config)
            const busy = busyNames.has(def.name)
            return (
              <li key={def.name}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(def.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(def.name)
                    }
                  }}
                  className="group flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors hover:border-[var(--p-1)] sm:flex-row sm:items-center"
                  style={{
                    background: 'var(--panel)',
                    borderColor: 'var(--line-strong)',
                    opacity: status === 'disabled' ? 0.72 : 1,
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-sm font-semibold text-foreground">
                        /{def.name}
                      </code>
                      <span
                        className="font-mono text-xs"
                        style={{ color: 'var(--text-3)' }}
                        aria-label="usage count"
                      >
                        · {(usageByName[def.name] ?? 0).toLocaleString()} uses
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{def.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {status !== 'enabled' && <StatusBadge status={status} />}
                      <CategoryBadge category={effectiveCategory(def, config)} />
                      <PermissionBadge level={effectivePermission(def, config)} />
                      {config.hidden && <HiddenBadge />}
                      {hasRestrictions(config) && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none"
                          style={{ color: 'var(--text-3)', background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
                        >
                          Restricted
                        </span>
                      )}
                    </div>
                  </div>

                  <div
                    className="flex items-center sm:self-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Switch
                      checked={config.enabled}
                      busy={busy}
                      onChange={(v) => onToggleEnabled(def.name, v)}
                    />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-3 py-1 text-xs font-medium transition"
      style={{
        background: active ? 'var(--p-soft)' : 'var(--panel)',
        borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
        color: active ? 'var(--p-1)' : 'var(--text-3)',
      }}
    >
      {children}
    </button>
  )
}

function Switch({
  checked,
  busy,
  onChange,
}: {
  checked: boolean
  busy?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={busy}
      title={checked ? 'Disable command' : 'Enable command'}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-60"
      style={{ background: checked ? 'var(--p-1)' : 'var(--line-strong)' }}
    >
      <span
        className="flex h-4 w-4 items-center justify-center rounded-full bg-white transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
      >
        {busy && <Loader2 size={10} className="animate-spin" style={{ color: 'var(--p-1)' }} />}
      </span>
    </button>
  )
}
