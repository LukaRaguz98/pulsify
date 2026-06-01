'use client'

import { useMemo, useState } from 'react'
import { ScrollText, Filter } from 'lucide-react'
import {
  AUTO_ACTION_LABELS,
  CATEGORY_COLORS,
  CATEGORY_IDS,
  CATEGORY_LABELS,
  SEVERITY_COLORS,
  type CategoryId,
} from '@/lib/ai-moderation'
import type { AIModerationEventRow } from '@/app/api/guilds/[guildId]/ai-moderation/events/route'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'

type Props = {
  events: AIModerationEventRow[]
}

const STATUS_LABELS: Record<AIModerationEventRow['status'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#f59e0b' },
  auto_actioned: { label: 'Auto-actioned', color: '#a855f7' },
  resolved: { label: 'Resolved', color: '#22c55e' },
  dismissed: { label: 'Dismissed', color: '#94a3b8' },
}

export function AIModerationLogs({ events }: Props) {
  const [filterCategory, setFilterCategory] = useState<CategoryId | ''>('')
  const [filterStatus, setFilterStatus] = useState<AIModerationEventRow['status'] | ''>('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (filterCategory && e.top_category !== filterCategory) return false
      if (filterStatus && e.status !== filterStatus) return false
      return true
    })
  }, [events, filterCategory, filterStatus])

  const paged = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const safePage = Math.min(Math.max(1, page), totalPages)
    const start = (safePage - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<ScrollText size={36} />}
        title="No history yet"
        description="Resolved and auto-actioned events will show up here once the AI starts moderating."
      />
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Filter size={14} className="text-muted-foreground shrink-0" />
          <FilterPill
            active={filterCategory === ''}
            onClick={() => { setFilterCategory(''); setPage(1) }}
          >
            All categories
          </FilterPill>
          {CATEGORY_IDS.map((id) => (
            <FilterPill
              key={id}
              active={filterCategory === id}
              onClick={() => { setFilterCategory(id); setPage(1) }}
              color={CATEGORY_COLORS[id]}
            >
              {CATEGORY_LABELS[id]}
            </FilterPill>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 overflow-x-auto pb-1">
          {(['', 'auto_actioned', 'resolved', 'dismissed'] as const).map((status) => {
            const label = status === '' ? 'Any status' : STATUS_LABELS[status as AIModerationEventRow['status']].label
            return (
              <FilterPill
                key={status || 'any'}
                active={filterStatus === status}
                onClick={() => { setFilterStatus(status as AIModerationEventRow['status'] | ''); setPage(1) }}
              >
                {label}
              </FilterPill>
            )
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ScrollText size={36} />}
          title="No entries match this filter"
          description="Try clearing the filters above."
        />
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--line-strong)' }}>
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-subtle">Category</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-subtle">Message</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-subtle">Status</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-subtle">Action</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-subtle">Confidence</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-subtle">When</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((e) => {
                const category = (e.top_category as CategoryId | null) ?? null
                const cat = category ? CATEGORY_LABELS[category] : '—'
                const catColor = category ? CATEGORY_COLORS[category] : '#94a3b8'
                const status = STATUS_LABELS[e.status]
                const severityColor = SEVERITY_COLORS[e.severity]
                return (
                  <tr
                    key={e.id}
                    className="border-b"
                    style={{
                      borderColor: 'var(--line-strong)',
                      background: 'color-mix(in srgb, var(--panel) 50%, transparent)',
                    }}
                  >
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium"
                        style={{ background: `${catColor}1f`, color: catColor }}
                      >
                        {cat}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      <p className="line-clamp-2 max-w-md text-xs" title={e.content}>
                        {e.content}
                      </p>
                      {(e.channel_name || e.author_name) && (
                        <p className="text-[11px] text-subtle">
                          {e.channel_name ? `#${e.channel_name}` : ''}
                          {e.channel_name && e.author_name ? ' · ' : ''}
                          {e.author_name ?? ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium"
                        style={{ background: `${status.color}1f`, color: status.color }}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {AUTO_ACTION_LABELS[e.action_taken]}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs" style={{ color: severityColor }}>
                        {Math.round(e.confidence * 100)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-subtle text-xs font-mono">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
          />
        </div>
      )}
    </div>
  )
}

function FilterPill({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-3 py-1 text-xs font-medium transition whitespace-nowrap"
      style={{
        background: active ? (color ? `${color}26` : 'var(--p-soft)') : 'var(--bg-2)',
        color: active ? (color ?? 'var(--p-1)') : 'var(--text-3)',
      }}
    >
      {children}
    </button>
  )
}
