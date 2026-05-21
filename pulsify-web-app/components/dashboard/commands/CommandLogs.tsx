'use client'

import { useMemo, useState } from 'react'
import { Search, ScrollText, Loader2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { LogStatusBadge, LOG_STATUS_STYLE } from './badges'
import type { CommandLogRow, CommandLogStatus } from '@/app/api/guilds/[guildId]/commands/logs/route'

type Props = {
  logs: CommandLogRow[]
  loading: boolean
}

const STATUS_OPTIONS: { value: CommandLogStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All outcomes' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'denied', label: 'Denied' },
  { value: 'cooldown', label: 'Cooldown' },
  { value: 'rate_limited', label: 'Rate limited' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'disabled', label: 'Disabled' },
]

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function CommandLogs({ logs, loading }: Props) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<CommandLogStatus | 'all'>('all')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logs.filter((log) => {
      if (status !== 'all' && log.status !== status) return false
      if (!q) return true
      return (
        log.command_name.toLowerCase().includes(q) ||
        (log.user_name ?? '').toLowerCase().includes(q) ||
        (log.channel_name ?? '').toLowerCase().includes(q)
      )
    })
  }, [logs, search, status])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search command, user or channel…"
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as CommandLogStatus | 'all')}
          className="rounded-lg border px-2.5 py-2 text-sm focus:outline-none focus:ring-1"
          style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={22} className="animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ScrollText size={28} />}
          title={logs.length === 0 ? 'No command activity yet' : 'No matching log entries'}
          description={
            logs.length === 0
              ? 'Every command run — successful or blocked — will be recorded here for auditing.'
              : 'Try a different search or outcome filter.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line-strong)' }}>
          {/* Header row (desktop) */}
          <div
            className="hidden grid-cols-[1fr_1fr_1fr_auto_auto] gap-3 border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider sm:grid"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-3)' }}
          >
            <span>Command</span>
            <span>Member</span>
            <span>Channel</span>
            <span>Outcome</span>
            <span className="text-right">When</span>
          </div>
          <ul>
            {filtered.map((log) => (
              <li
                key={log.id}
                className="grid grid-cols-1 gap-1 border-b px-4 py-3 last:border-0 sm:grid-cols-[1fr_1fr_1fr_auto_auto] sm:items-center sm:gap-3"
                style={{ borderColor: 'var(--line-strong)' }}
              >
                <div className="min-w-0">
                  <code className="font-mono text-sm text-foreground">/{log.command_name}</code>
                  {log.detail && (
                    <p
                      className="truncate text-[11px]"
                      style={{ color: log.status === 'failed' ? '#f87171' : 'var(--text-3)' }}
                      title={log.detail}
                    >
                      {log.detail}
                    </p>
                  )}
                </div>
                <span className="truncate text-xs text-muted-foreground">
                  {log.user_name ?? <span className="text-subtle">—</span>}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {log.channel_name ? `#${log.channel_name}` : <span className="text-subtle">—</span>}
                </span>
                <span className="sm:justify-self-start">
                  <LogStatusBadge status={log.status} />
                </span>
                <span
                  className="text-xs sm:justify-self-end"
                  style={{ color: LOG_STATUS_STYLE[log.status]?.color ?? 'var(--text-3)' }}
                  title={new Date(log.created_at).toLocaleString()}
                >
                  {relativeTime(log.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
