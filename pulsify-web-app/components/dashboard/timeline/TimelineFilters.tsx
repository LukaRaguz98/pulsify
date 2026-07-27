'use client'

import { useMemo, useState } from 'react'
import { Filter, Search, SlidersHorizontal, X } from 'lucide-react'
import {
  CATEGORY_ACCENT,
  CATEGORY_LABELS,
  TIMELINE_CATEGORIES,
  TIMELINE_MODULES,
  eventLabel,
  eventTypesForCategory,
  TIMELINE_EVENT_TYPES,
  formatActor,
  hasActiveFilters,
  EMPTY_FILTERS,
  type TimelineActorCount,
  type TimelineCategory,
  type TimelineFilters,
} from '@/lib/timeline'

type Props = {
  filters: TimelineFilters
  onChange: (next: TimelineFilters) => void
  /** Administrators who appear in the retained history, most active first. */
  actors: TimelineActorCount[]
  /** Modules that actually have events, so the dropdown isn't a wish list. */
  activeModules: string[]
}

/**
 * The filter bar.
 *
 * Category is always visible as chips — it's the filter people reach for — and
 * everything else (administrator, member, module, event type, date range) sits
 * behind "More filters" so the default view stays a timeline rather than a
 * search form. Search is separate and always visible: it's the other half of
 * "find that one change".
 */
export function TimelineFilterBar({ filters, onChange, actors, activeModules }: Props) {
  const [expanded, setExpanded] = useState(false)
  const active = hasActiveFilters(filters)

  const set = (patch: Partial<TimelineFilters>) => onChange({ ...filters, ...patch })

  // Event types narrow to the selected category — offering "Backup restored"
  // while filtering Roles is just a way to produce an empty feed.
  const eventTypes = useMemo(
    () =>
      filters.category === 'all'
        ? TIMELINE_EVENT_TYPES
        : eventTypesForCategory(filters.category as TimelineCategory),
    [filters.category],
  )

  const moduleOptions = useMemo(
    () =>
      activeModules
        .map((key) => ({ key, label: TIMELINE_MODULES[key]?.label ?? key }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [activeModules],
  )

  return (
    <div className="mb-5 space-y-3">
      {/* Search + expand toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="Search a member, role, channel, administrator or keyword…"
            aria-label="Search the timeline"
            className="w-full rounded-lg border py-2 pl-9 pr-8 text-sm outline-none transition-colors focus:border-[var(--p-1)]"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => set({ query: '' })}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition hover:text-foreground"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors"
          style={{
            background: expanded ? 'var(--p-soft)' : 'var(--panel)',
            borderColor: expanded ? 'var(--p-1)' : 'var(--line-strong)',
            color: expanded ? 'var(--p-1)' : 'var(--text-2)',
          }}
          aria-expanded={expanded}
        >
          <SlidersHorizontal size={13} />
          More filters
        </button>
        {active && (
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_FILTERS })}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
          >
            <X size={13} />
            Clear all
          </button>
        )}
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
          <Filter size={11} /> Category
        </span>
        <CategoryChipButton
          label="All"
          active={filters.category === 'all'}
          onClick={() => set({ category: 'all', eventType: 'all' })}
        />
        {TIMELINE_CATEGORIES.map((cat) => (
          <CategoryChipButton
            key={cat}
            label={CATEGORY_LABELS[cat]}
            accent={CATEGORY_ACCENT[cat]}
            active={filters.category === cat}
            // Switching category invalidates a narrower event-type choice.
            onClick={() => set({ category: cat, eventType: 'all' })}
          />
        ))}
      </div>

      {/* Advanced filters */}
      {expanded && (
        <div
          className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-3"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <Field label="Administrator">
            <Select
              value={filters.actor}
              onChange={(v) => set({ actor: v })}
              options={[
                { value: 'all', label: 'Anyone' },
                ...actors.map((a) => ({
                  value: a.id,
                  label: `${formatActor({ id: a.id, name: a.name, username: a.username })} (${a.count})`,
                })),
              ]}
            />
          </Field>

          <Field label="Member" hint="Discord user ID">
            <input
              value={filters.member === 'all' ? '' : filters.member}
              onChange={(e) => {
                const raw = e.target.value.trim()
                set({ member: raw === '' ? 'all' : raw })
              }}
              placeholder="e.g. 214087543024648193"
              inputMode="numeric"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--p-1)]"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          </Field>

          <Field label="Module">
            <Select
              value={filters.module}
              onChange={(v) => set({ module: v })}
              options={[
                { value: 'all', label: 'Every module' },
                ...moduleOptions.map((m) => ({ value: m.key, label: m.label })),
              ]}
            />
          </Field>

          <Field label="Event type">
            <Select
              value={filters.eventType}
              onChange={(v) => set({ eventType: v })}
              options={[
                { value: 'all', label: 'Every event' },
                ...eventTypes.map((t) => ({ value: t, label: eventLabel(t) })),
              ]}
            />
          </Field>

          <Field label="From">
            <input
              type="date"
              value={filters.from ?? ''}
              max={filters.to ?? undefined}
              onChange={(e) => set({ from: e.target.value || null })}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--p-1)]"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          </Field>

          <Field label="To">
            <input
              type="date"
              value={filters.to ?? ''}
              min={filters.from ?? undefined}
              onChange={(e) => set({ to: e.target.value || null })}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--p-1)]"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          </Field>
        </div>
      )}
    </div>
  )
}

function CategoryChipButton({
  label,
  accent,
  active,
  onClick,
}: {
  label: string
  accent?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
      style={{
        background: active ? 'var(--p-soft)' : 'var(--bg-2)',
        borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
        color: active ? 'var(--p-1)' : 'var(--text-2)',
      }}
    >
      {accent && <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />}
      {label}
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline gap-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
        {label}
        {hint && <span className="font-normal normal-case tracking-normal text-subtle">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--p-1)]"
      style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
