'use client'

import { useMemo, useState } from 'react'
import { Search, Hash, MessageSquare } from 'lucide-react'
import {
  STATUS_META,
  PRIORITY_META,
  PRIORITIES,
  timeAgo,
  type Ticket,
  type TicketConfig,
  type TicketStatus,
  type TicketPriority,
} from '@/lib/tickets'
import { StatusBadge, PriorityBadge } from './badges'

type Props = {
  tickets: Ticket[]
  config: TicketConfig
  onSelect: (id: string) => void
}

type StatusFilter = TicketStatus | 'all' | 'active'
type PriorityFilter = TicketPriority | 'all'

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

export function TicketList({ tickets, config, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [priority, setPriority] = useState<PriorityFilter>('all')
  const [typeId, setTypeId] = useState<string>('all')

  const typeOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of tickets) {
      if (t.type_id) seen.set(t.type_id, t.type_label ?? t.type_id)
    }
    for (const t of config.ticket_types) seen.set(t.id, t.label)
    return [...seen.entries()].map(([id, label]) => ({ id, label }))
  }, [tickets, config.ticket_types])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tickets.filter((t) => {
      if (status === 'active' && t.status === 'closed') return false
      if (status !== 'all' && status !== 'active' && t.status !== status) return false
      if (priority !== 'all' && t.priority !== priority) return false
      if (typeId !== 'all' && t.type_id !== typeId) return false
      if (q) {
        const hay = `#${t.number} ${t.type_label ?? ''} ${t.subject ?? ''} ${t.opener_name ?? ''} ${t.claimed_by_name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tickets, query, status, priority, typeId])

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-3)' }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tickets, members, subjects…"
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
            style={selectStyle}
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
          style={selectStyle}
        >
          <option value="active">Active</option>
          <option value="all">All statuses</option>
          {(['open', 'claimed', 'closed'] as TicketStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
        </select>
        <select
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
          style={selectStyle}
        >
          <option value="all">All types</option>
          {typeOptions.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as PriorityFilter)}
          className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
          style={selectStyle}
        >
          <option value="all">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_META[p].label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div
          className="rounded-xl border py-12 text-center text-sm"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
        >
          No tickets match these filters.
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-xl border"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          {filtered.map((t, i) => (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
              style={{
                borderTop: i === 0 ? 'none' : '1px solid var(--line-strong)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
              >
                <Hash size={12} />
                {t.number}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {t.subject || t.type_label || 'Ticket'}
                  </span>
                  <PriorityBadge priority={t.priority} />
                </div>
                <p className="truncate text-xs" style={{ color: 'var(--text-3)' }}>
                  {t.type_label ?? 'Ticket'} · opened by {t.opener_name ?? 'a member'} · {timeAgo(t.opened_at)}
                  {t.claimed_by_name ? ` · claimed by ${t.claimed_by_name}` : ''}
                </p>
              </div>
              {t.channel_id && (
                <span
                  className="hidden shrink-0 items-center gap-1 text-xs sm:flex"
                  style={{ color: 'var(--text-3)' }}
                >
                  <MessageSquare size={12} />
                </span>
              )}
              <StatusBadge status={t.status} />
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs" style={{ color: 'var(--text-3)' }}>
        Showing {filtered.length} of {tickets.length} ticket{tickets.length === 1 ? '' : 's'}.
      </p>
    </div>
  )
}
