'use client'

import { DatabaseBackup, RotateCcw, Trash2, CalendarClock, Archive, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import type { RecoveryAction, RecoveryLogEntry, RecoveryStatus } from '@/lib/backups'
import { LocalTime } from './LocalTime'

const ACTION_META: Record<RecoveryAction, { label: string; icon: React.ReactNode }> = {
  backup_created: { label: 'Backup created', icon: <DatabaseBackup size={14} /> },
  restore: { label: 'Restored', icon: <RotateCcw size={14} /> },
  backup_deleted: { label: 'Backup deleted', icon: <Trash2 size={14} /> },
  backup_pruned: { label: 'Old backup pruned', icon: <Archive size={14} /> },
  schedule_updated: { label: 'Schedule updated', icon: <CalendarClock size={14} /> },
}

const STATUS_META: Record<RecoveryStatus, { color: string; icon: React.ReactNode }> = {
  success: { color: '#22c55e', icon: <CheckCircle2 size={12} /> },
  partial: { color: '#f59e0b', icon: <AlertTriangle size={12} /> },
  failure: { color: '#f87171', icon: <XCircle size={12} /> },
}

export function RecoveryLog({ logs }: { logs: RecoveryLogEntry[] }) {
  if (logs.length === 0) {
    return (
      <p className="rounded-lg border px-3 py-4 text-sm text-muted-foreground" style={{ borderColor: 'var(--line-strong)' }}>
        No backup or restore activity yet.
      </p>
    )
  }
  return (
    <ol className="space-y-1.5">
      {logs.map((log) => {
        const meta = ACTION_META[log.action]
        const status = STATUS_META[log.status]
        return (
          <li
            key={log.id}
            className="flex items-start gap-3 rounded-lg border px-3 py-2.5"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
          >
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
            >
              {meta.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-foreground">{meta.label}</span>
                {log.backupName && (
                  <span className="truncate text-xs text-muted-foreground">· {log.backupName}</span>
                )}
                <span className="ml-auto inline-flex items-center gap-1 text-[11px]" style={{ color: status.color }}>
                  {status.icon}
                </span>
              </div>
              {log.detail && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground" title={log.detail}>
                  {log.detail}
                </p>
              )}
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
                {log.actorName ?? 'Pulse'} · <LocalTime iso={log.createdAt} mode="relative" />
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
