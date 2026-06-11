'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, AlertTriangle, DatabaseBackup, Check } from 'lucide-react'
import { SECTION_META, type BackupSectionKey } from '@/lib/backups'
import type { CaptureSnapshot } from '@/app/dashboard/[guildId]/(management)/backups/page'
import { createBackup } from '@/app/dashboard/[guildId]/(management)/backups/actions'
import { BackupIcon } from './icons'

export function CreateBackupDialog({
  guildId,
  snapshot,
  onClose,
  onCreated,
}: {
  guildId: string
  snapshot: CaptureSnapshot
  onClose: () => void
  onCreated: () => void
}) {
  const capturable = snapshot.capturable
  const defaultName = `Backup — ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
  const [name, setName] = useState(defaultName)
  const [selected, setSelected] = useState<BackupSectionKey[]>(capturable)
  const [error, setError] = useState<string | null>(null)
  const [busy, startCreate] = useTransition()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const toggle = (key: BackupSectionKey) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the backup a name.')
      return
    }
    if (selected.length === 0) {
      setError('Select at least one section to back up.')
      return
    }
    setError(null)
    startCreate(async () => {
      const res = await createBackup(guildId, { name: trimmed, sectionKeys: selected, type: 'manual' })
      if (res.ok) onCreated()
      else setError(res.error)
    })
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create backup"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex shrink-0 items-start gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            <DatabaseBackup size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-foreground">Create a backup</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Capture a versioned snapshot of your server configuration.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Backup name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                Sections to capture
              </span>
              <button
                type="button"
                onClick={() => setSelected(selected.length === capturable.length ? [] : capturable)}
                className="text-xs font-medium"
                style={{ color: 'var(--p-1)' }}
              >
                {selected.length === capturable.length ? 'Clear all' : 'Select all'}
              </button>
            </div>
            {capturable.length === 0 ? (
              <p className="rounded-lg border px-3 py-3 text-sm text-muted-foreground" style={{ borderColor: 'var(--line-strong)' }}>
                There&apos;s nothing configured to back up yet. Set up some features first.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {capturable.map((key) => {
                  const meta = SECTION_META[key]
                  const on = selected.includes(key)
                  const count = snapshot.counts[key]
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggle(key)}
                      className="flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors"
                      style={{
                        borderColor: on ? 'var(--p-1)' : 'var(--line-strong)',
                        background: on ? 'var(--p-soft)' : 'var(--panel)',
                      }}
                    >
                      <span
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                        style={{ background: `color-mix(in srgb, ${meta.accent} 18%, transparent)`, color: meta.accent }}
                      >
                        <BackupIcon name={meta.icon} size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {meta.label}
                          {typeof count === 'number' && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">({count})</span>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground">{meta.description}</span>
                      </span>
                      <span
                        className="ml-auto mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded"
                        style={{
                          border: `1.5px solid ${on ? 'var(--p-1)' : 'var(--line-strong)'}`,
                          background: on ? 'var(--p-1)' : 'transparent',
                        }}
                      >
                        {on && <Check size={11} color="white" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

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
          className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || capturable.length === 0}
            className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50"
            style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <DatabaseBackup size={13} />}
            {busy ? 'Capturing…' : 'Create backup'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
