'use client'

import { useMemo, useState } from 'react'
import { ScrollText, Search } from 'lucide-react'
import {
  LOG_LEVEL_META,
  providerById,
  timeAgo,
  type IntegrationLog,
  type Integration,
  type LogLevel,
} from '@/lib/integrations'
import { IntegrationIcon } from './icons'

const LEVELS: ('all' | LogLevel)[] = ['all', 'success', 'info', 'warning', 'error']
const LEVEL_LABEL: Record<'all' | LogLevel, string> = {
  all: 'All',
  success: 'Success',
  info: 'Info',
  warning: 'Warnings',
  error: 'Errors',
}

export function IntegrationLogs({
  logs,
  integrations,
  channels = [],
}: {
  logs: IntegrationLog[]
  integrations: Integration[]
  channels?: { id: string; name: string }[]
}) {
  const [level, setLevel] = useState<'all' | LogLevel>('all')
  const [integrationId, setIntegrationId] = useState<'all' | string>('all')
  const [search, setSearch] = useState('')

  const byId = useMemo(
    () => new Map(integrations.map((i) => [i.id, i])),
    [integrations],
  )

  // Render any raw <#id> channel mentions (older log entries) as #name — the
  // mention syntax only resolves inside Discord, not in this panel.
  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels])
  const renderMessage = (msg: string) =>
    msg.replace(/<#(\d+)>/g, (_, id) => `#${channelById.get(id) ?? id}`)

  // Only integrations that actually appear in the log set are worth offering as
  // a filter — keeps the dropdown short and meaningful.
  const logged = useMemo(() => {
    const seen = new Set(logs.map((l) => l.integration_id))
    return integrations.filter((i) => seen.has(i.id))
  }, [logs, integrations])

  const q = search.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      logs.filter((l) => {
        if (level !== 'all' && l.level !== level) return false
        if (integrationId !== 'all' && l.integration_id !== integrationId) return false
        if (!q) return true
        const label = byId.get(l.integration_id)?.label ?? ''
        return (
          (l.message?.toLowerCase().includes(q) ?? false) ||
          l.event.toLowerCase().includes(q) ||
          label.toLowerCase().includes(q)
        )
      }),
    [logs, level, integrationId, q, byId],
  )

  if (logs.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl border py-12 text-center"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
          <ScrollText size={22} />
        </div>
        <p className="font-semibold text-foreground">No activity yet</p>
        <p className="mt-1.5 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
          Connects, tests, syncs and errors will show up here as a diagnostic trail.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex flex-wrap rounded-lg border p-0.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
          {LEVELS.map((l) => {
            const active = level === l
            return (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                className="rounded-md px-3 py-1 text-xs font-medium transition"
                style={{ background: active ? 'var(--p-soft)' : 'transparent', color: active ? 'var(--p-1)' : 'var(--text-3)' }}
              >
                {LEVEL_LABEL[l]}
              </button>
            )
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {logged.length > 1 && (
            <select
              value={integrationId}
              onChange={(e) => setIntegrationId(e.target.value)}
              className="rounded-lg border py-2 pl-3 pr-7 text-sm focus:outline-none focus:ring-1"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            >
              <option value="all">All integrations</option>
              {logged.map((i) => (
                <option key={i.id} value={i.id}>{i.label}</option>
              ))}
            </select>
          )}
          <div className="relative sm:w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search logs…"
              className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border px-4 py-6 text-center text-sm" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
          No matching log entries.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
          {filtered.slice(0, 100).map((log) => {
            const meta = LOG_LEVEL_META[log.level]
            const integration = byId.get(log.integration_id)
            const provider = integration ? providerById(integration.provider) : undefined
            return (
              <li key={log.id} className="flex items-start gap-3 px-4 py-3" style={{ borderColor: 'var(--line-strong)' }}>
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg" style={{ background: `${meta.color}1f`, color: meta.color }}>
                  <IntegrationIcon name={meta.icon} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {provider && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: provider.accent }}>
                        <IntegrationIcon name={provider.icon} size={12} />
                        {integration?.label ?? provider.name}
                      </span>
                    )}
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
                      {log.event}
                    </span>
                  </div>
                  {log.message && (
                    <p className="mt-0.5 text-sm" style={{ color: 'var(--text-2)' }}>{renderMessage(log.message)}</p>
                  )}
                </div>
                <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-3)' }}>{timeAgo(log.created_at)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
