'use client'

import { useMemo, useState } from 'react'
import { ScrollText } from 'lucide-react'
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

  const byId = useMemo(
    () => new Map(integrations.map((i) => [i.id, i])),
    [integrations],
  )

  // Render any raw <#id> channel mentions (older log entries) as #name — the
  // mention syntax only resolves inside Discord, not in this panel.
  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels])
  const renderMessage = (msg: string) =>
    msg.replace(/<#(\d+)>/g, (_, id) => `#${channelById.get(id) ?? id}`)

  const filtered = useMemo(
    () => (level === 'all' ? logs : logs.filter((l) => l.level === level)),
    [logs, level],
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

      {filtered.length === 0 ? (
        <p className="rounded-xl border px-4 py-6 text-center text-sm" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
          No {LEVEL_LABEL[level].toLowerCase()} entries.
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
