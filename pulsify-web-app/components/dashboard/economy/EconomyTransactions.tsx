'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertCircle, Coins, ReceiptText, Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import {
  formatCoins,
  TRANSACTION_KIND_META,
  TRANSACTION_REASON_LABELS,
  type EconomyTransaction,
  type TransactionKind,
} from '@/lib/economy'

type Props = { guildId: string }

type Scope = 'guild' | 'global'

const KIND_FILTERS: { value: TransactionKind | ''; label: string }[] = [
  { value: '', label: 'All kinds' },
  { value: 'earn', label: 'Earned' },
  { value: 'reward', label: 'Rewards' },
  { value: 'spend', label: 'Spent' },
  { value: 'transfer_in', label: 'Transfers in' },
  { value: 'transfer_out', label: 'Transfers out' },
  { value: 'admin_grant', label: 'Admin grants' },
  { value: 'admin_remove', label: 'Admin removals' },
]

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * High-frequency earning is written as ONE row per member / server / source /
 * day, so the row says how many awards it stands for — otherwise "+142 coins"
 * next to "Messages sent" reads like a single suspicious payout.
 */
function rollupLabel(t: EconomyTransaction): string | null {
  const n = t.rollup_count ?? 0
  if (!t.rollup_day || n < 1) return null
  return `${n.toLocaleString()} award${n === 1 ? '' : 's'} that day`
}

function describeRow(t: EconomyTransaction): string {
  if (t.kind === 'transfer_in') return `Transfer from ${t.counterparty_name ?? 'a member'}`
  if (t.kind === 'transfer_out') return `Transfer to ${t.counterparty_name ?? 'a member'}`
  if (t.kind === 'admin_grant' || t.kind === 'admin_remove') {
    return `${TRANSACTION_KIND_META[t.kind].label} by ${t.actor_name ?? 'an operator'}`
  }
  return TRANSACTION_REASON_LABELS[t.reason ?? ''] ?? 'Balance change'
}

/**
 * The coin ledger: every balance change with kind, source server and context —
 * filterable by scope and kind, with name search and pagination. The audit
 * trail for the whole economy.
 */
export function EconomyTransactions({ guildId }: Props) {
  const [scope, setScope] = useState<Scope>('guild')
  const [kind, setKind] = useState('')
  // Activity earning is hidden by default — even rolled up to one row per
  // member/source/day it outnumbers the rows people come here for (rewards,
  // spends, transfers, level-ups, admin actions).
  const [includeActivity, setIncludeActivity] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const [rows, setRows] = useState<EconomyTransaction[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        scope,
        offset: String((page - 1) * pageSize),
        limit: String(pageSize),
      })
      if (kind) params.set('kind', kind)
      if (includeActivity) params.set('activity', '1')
      if (debouncedQuery) params.set('q', debouncedQuery)
      const res = await fetch(`/api/guilds/${guildId}/economy/transactions?${params}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Request failed (${res.status})`)
      }
      const json = (await res.json()) as { rows: EconomyTransaction[]; total: number }
      setRows(json.rows)
      setTotal(json.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions.')
    } finally {
      setLoading(false)
    }
  }, [guildId, scope, kind, includeActivity, debouncedQuery, page, pageSize])

  useEffect(() => {
    load()
  }, [load])

  // Any filter change snaps back to page 1.
  useEffect(() => {
    setPage(1)
  }, [scope, kind, includeActivity, debouncedQuery, pageSize])

  const segment = (active: boolean): React.CSSProperties =>
    active ? { background: 'var(--p-soft)', color: 'var(--text)' } : { color: 'var(--text-2)' }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div
          className="inline-flex rounded-lg border p-0.5"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <button
            onClick={() => setScope('guild')}
            className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            style={segment(scope === 'guild')}
          >
            This server
          </button>
          <button
            onClick={() => setScope('global')}
            className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            style={segment(scope === 'global')}
          >
            All servers
          </button>
        </div>

        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-lg border px-2.5 py-1.5 text-xs"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
        >
          {KIND_FILTERS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>

        <button
          onClick={() => setIncludeActivity((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors"
          style={
            includeActivity
              ? { background: 'var(--p-soft)', borderColor: 'var(--p-1)', color: 'var(--p-1)' }
              : { background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text-3)' }
          }
          title="Per-message and per-voice-minute coin earnings are hidden by default to keep the ledger readable. Toggle to include them."
        >
          <Activity size={13} />
          {includeActivity ? 'Activity earnings: on' : 'Activity earnings: off'}
        </button>

        <div className="relative ml-auto w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search member, note…"
            className="w-full rounded-lg border py-1.5 pl-9 pr-3 text-sm"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={8} columns={4} />
      ) : error ? (
        <div
          className="flex items-center gap-3 rounded-xl border p-5"
          style={{ background: 'var(--panel)', borderColor: 'rgba(239,68,68,0.35)' }}
        >
          <AlertCircle size={18} style={{ color: '#f87171' }} />
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ReceiptText size={22} />}
          title="No transactions match"
          description={
            !includeActivity
              ? 'No standout transactions for these filters. Per-message and per-voice-minute earnings are hidden — turn on “Activity earnings” to include them.'
              : scope === 'guild'
                ? 'Nothing recorded from this server for these filters yet — try the all-servers scope.'
                : 'Nothing in the economy matches these filters yet.'
          }
          variant="muted"
        />
      ) : (
        <div
          className="overflow-hidden rounded-xl border"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {rows.map((t) => {
              const positive = t.amount >= 0
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      background: 'var(--bg-2)',
                      color: positive ? 'var(--green)' : 'var(--red)',
                    }}
                  >
                    <Coins size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {t.user_name ?? t.user_id}
                      <span className="ml-2 font-normal text-subtle">{describeRow(t)}</span>
                    </p>
                    <p className="truncate text-xs text-subtle">
                      {[t.guild_name, rollupLabel(t), t.note, timeAgo(t.created_at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className="font-mono text-sm font-semibold"
                      style={{ color: positive ? 'var(--green)' : 'var(--red)' }}
                    >
                      {positive ? '+' : '−'}
                      {formatCoins(Math.abs(t.amount))}
                    </p>
                    <p className="text-[11px] text-subtle">{formatCoins(t.balance_after)} after</p>
                  </div>
                </li>
              )
            })}
          </ul>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}
    </div>
  )
}
