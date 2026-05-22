'use client'

import { ShieldCheck } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import type { WarningEntry, ModLogEntry } from '@/lib/member-profile'

const ACTION_LABEL: Record<string, string> = {
  warn: 'Warning',
  timeout: 'Timeout',
  remove_timeout: 'Timeout removed',
  kick: 'Kick',
  ban: 'Ban',
  unban: 'Unban',
  nickname: 'Nickname change',
  add_role: 'Role added',
  remove_role: 'Role removed',
  delete_message: 'Message deleted',
  bulk_delete_messages: 'Messages deleted',
}

const ACTION_COLOR: Record<string, string> = {
  warn: '#f59e0b',
  timeout: '#f59e0b',
  remove_timeout: '#4ade80',
  kick: '#fb923c',
  ban: '#ef4444',
  unban: '#4ade80',
  nickname: '#a78bfa',
  add_role: '#60a5fa',
  remove_role: '#94a3b8',
  delete_message: '#ef4444',
  bulk_delete_messages: '#ef4444',
}

type Entry = {
  id: string
  action: string
  reason: string | null
  moderator: string | null
  created_at: string
  inactive?: boolean
}

export function ModerationHistory({
  warnings,
  modLogs,
}: {
  warnings: WarningEntry[]
  modLogs: ModLogEntry[]
}) {
  const entries: Entry[] = [
    ...warnings.map((w) => ({
      id: `w-${w.id}`,
      action: 'warn',
      reason: w.reason,
      moderator: w.moderator_username,
      created_at: w.created_at,
      inactive: !w.active,
    })),
    ...modLogs.map((l) => ({
      id: `l-${l.id}`,
      action: l.action,
      reason: l.reason,
      moderator: l.moderator_username ?? l.moderator_id,
      created_at: l.created_at,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const MAX_VISIBLE = 5
  const visible = entries.slice(0, MAX_VISIBLE)
  const hiddenCount = entries.length - visible.length

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck size={32} />}
        title="Clean record"
        description="No warnings, timeouts, kicks or bans on file for this member."
      />
    )
  }

  return (
    <>
      <ol className="relative space-y-4 pl-5">
        <span className="absolute left-[5px] top-1 bottom-1 w-px" style={{ background: 'var(--line-strong)' }} />
        {visible.map((e) => {
        const color = ACTION_COLOR[e.action] ?? '#94a3b8'
        const label = ACTION_LABEL[e.action] ?? e.action
        return (
          <li key={e.id} className="relative">
            <span
              className="absolute -left-5 top-1 h-[11px] w-[11px] rounded-full border-2"
              style={{ background: 'var(--panel)', borderColor: color }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
                style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
              >
                {label}
              </span>
              {e.inactive && (
                <span className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-subtle" style={{ background: 'var(--bg-2)' }}>
                  Cleared
                </span>
              )}
              <span className="text-xs text-subtle">{new Date(e.created_at).toLocaleString('en-US')}</span>
            </div>
            {e.reason && <p className="mt-1 text-sm text-muted-foreground">{e.reason}</p>}
            <p className="mt-0.5 text-xs text-subtle">by {e.moderator ?? 'Unknown'}</p>
          </li>
        )
        })}
      </ol>
      {hiddenCount > 0 && (
        <p className="mt-3 pl-5 text-xs text-subtle">
          Showing the {MAX_VISIBLE} most recent of {entries.length} entries.
        </p>
      )}
    </>
  )
}
