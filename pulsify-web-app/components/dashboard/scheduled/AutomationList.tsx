'use client'

import { useMemo, useState } from 'react'
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Play,
  Clock,
  Loader2,
  Zap,
  CalendarClock,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import {
  ACTION_BY_TYPE,
  describeSchedule,
  relativeTimeLabel,
  type Automation,
} from '@/lib/automations'
import { ActionIcon } from './icons'
import { WorkflowStatusBadge } from './badges'

type Props = {
  automations: Automation[]
  busyIds: Set<string>
  onCreate: () => void
  onEdit: (a: Automation) => void
  onToggle: (a: Automation, enabled: boolean) => void
  onRunNow: (a: Automation) => void
  onDelete: (a: Automation) => void
}

function Toggle({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      aria-label={enabled ? 'Disable workflow' : 'Enable workflow'}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
      style={{
        background: enabled ? 'linear-gradient(90deg, var(--p-1), var(--p-2))' : 'var(--bg-2)',
        boxShadow: enabled ? '0 0 12px -2px var(--p-glow)' : 'none',
        border: enabled ? 'none' : '1px solid var(--line-strong)',
      }}
    >
      <span
        className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: enabled ? 'translateX(24px)' : 'translateX(4px)' }}
      />
    </button>
  )
}

export function AutomationList({
  automations,
  busyIds,
  onCreate,
  onEdit,
  onToggle,
  onRunNow,
  onDelete,
}: Props) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return automations.filter((a) => {
      if (filter === 'active' && !a.enabled) return false
      if (filter === 'paused' && a.enabled) return false
      if (!q) return true
      return (
        a.name.toLowerCase().includes(q) ||
        ACTION_BY_TYPE[a.action_type]?.label.toLowerCase().includes(q)
      )
    })
  }, [automations, search, filter])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workflows…"
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
            {(['all', 'active', 'paused'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className="rounded-md px-3 py-1 text-xs font-medium capitalize transition"
                style={{
                  background: filter === f ? 'var(--p-soft)' : 'transparent',
                  color: filter === f ? 'var(--p-1)' : 'var(--text-3)',
                }}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
          >
            <Plus size={14} />
            New workflow
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={28} />}
          title={automations.length === 0 ? 'No workflows yet' : 'No matching workflows'}
          description={
            automations.length === 0
              ? 'Create a scheduled workflow to automate announcements, role sync, channel locks, reports and more.'
              : 'Try a different search or filter.'
          }
          action={
            automations.length === 0 ? (
              <button
                type="button"
                onClick={onCreate}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all"
                style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
              >
                <Plus size={14} />
                Create your first workflow
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((a) => {
            const def = ACTION_BY_TYPE[a.action_type]
            const busy = busyIds.has(a.id)
            const color = def?.color ?? '#8b5cf6'
            return (
              <div
                key={a.id}
                className="flex flex-col rounded-xl border p-4 transition-colors"
                style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}1f`, color }}>
                      <ActionIcon name={def?.icon ?? 'Zap'} size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{a.name}</p>
                      <p className="truncate text-xs text-subtle">{def?.label ?? a.action_type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {busy && <Loader2 size={13} className="animate-spin" style={{ color: 'var(--text-3)' }} />}
                    <Toggle enabled={a.enabled} disabled={busy} onChange={(v) => onToggle(a, v)} />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={12} />
                    {describeSchedule(a.schedule_type, a.schedule_config)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Zap size={12} />
                    {a.run_count.toLocaleString()} run{a.run_count === 1 ? '' : 's'}
                    {a.fail_count > 0 && (
                      <span style={{ color: '#f87171' }}>· {a.fail_count.toLocaleString()} failed</span>
                    )}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3" style={{ borderColor: 'var(--line-strong)' }}>
                  <div className="flex items-center gap-2">
                    <WorkflowStatusBadge enabled={a.enabled} lastStatus={a.last_status} />
                    {a.enabled && a.next_run_at && (
                      <span className="text-[11px]" style={{ color: 'var(--text-3)' }} title={new Date(a.next_run_at).toLocaleString()}>
                        next {relativeTimeLabel(a.next_run_at, { future: true })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton title="Run now" onClick={() => onRunNow(a)} disabled={busy}>
                      <Play size={13} />
                    </IconButton>
                    <IconButton title="Edit" onClick={() => onEdit(a)} disabled={busy}>
                      <Pencil size={13} />
                    </IconButton>
                    <IconButton title="Delete" onClick={() => onDelete(a)} disabled={busy} danger>
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function IconButton({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-lg border transition-colors disabled:opacity-40"
      style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.color = danger ? '#f87171' : 'var(--text)'
        e.currentTarget.style.borderColor = danger ? 'rgba(239,68,68,0.4)' : 'var(--p-1)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-3)'
        e.currentTarget.style.borderColor = 'var(--line-strong)'
      }}
    >
      {children}
    </button>
  )
}
