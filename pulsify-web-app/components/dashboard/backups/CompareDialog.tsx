'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, AlertTriangle, GitCompareArrows, ArrowRight } from 'lucide-react'
import type { ServerBackup } from '@/lib/backups'
import { compareBackups, type CompareResult } from '@/app/dashboard/[guildId]/(management)/backups/actions'
import { DiffView } from './DiffView'

export function CompareDialog({
  guildId,
  backups,
  initialBaseId,
  initialTargetId,
  onClose,
}: {
  guildId: string
  backups: ServerBackup[]
  initialBaseId?: string
  initialTargetId?: string
  onClose: () => void
}) {
  const [baseId, setBaseId] = useState(initialBaseId ?? backups[1]?.id ?? '')
  const [targetId, setTargetId] = useState(initialTargetId ?? backups[0]?.id ?? '')
  const [result, setResult] = useState<CompareResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, startLoad] = useTransition()

  const run = useCallback(() => {
    if (!baseId || !targetId || baseId === targetId) {
      setResult(null)
      return
    }
    setError(null)
    startLoad(async () => {
      const res = await compareBackups(guildId, baseId, targetId)
      if (res.ok) setResult(res.data)
      else {
        setError(res.error)
        setResult(null)
      }
    })
  }, [guildId, baseId, targetId])

  useEffect(() => {
    run()
  }, [run])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined') return null

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg-2)',
    borderColor: 'var(--line-strong)',
    color: 'var(--text)',
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compare backups"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex shrink-0 items-start gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            <GitCompareArrows size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-foreground">Compare backups</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">See what changed between two snapshots.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Pickers */}
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">From (older)</span>
              <select
                value={baseId}
                onChange={(e) => setBaseId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={selectStyle}
              >
                {backups.map((b) => (
                  <option key={b.id} value={b.id}>
                    #{b.version} · {b.name}
                  </option>
                ))}
              </select>
            </label>
            <ArrowRight size={16} className="mb-2.5 shrink-0 text-muted-foreground" />
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">To (newer)</span>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={selectStyle}
              >
                {backups.map((b) => (
                  <option key={b.id} value={b.id}>
                    #{b.version} · {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {baseId === targetId && (
            <p className="text-sm text-muted-foreground">Pick two different backups to compare.</p>
          )}

          {loading ? (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-4 text-sm text-muted-foreground" style={{ borderColor: 'var(--line-strong)' }}>
              <Loader2 size={14} className="animate-spin" /> Comparing…
            </div>
          ) : result ? (
            <DiffView diff={result.diff} emptyText="These two backups are identical." />
          ) : null}

          {error && (
            <div
              className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
            >
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div
          className="flex shrink-0 items-center justify-end border-t px-5 py-3"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
