'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, AlertTriangle, RotateCcw, Check, ShieldQuestion } from 'lucide-react'
import {
  SECTION_META,
  sectionKeysPresent,
  isRestorable,
  type ServerBackup,
  type BackupSectionKey,
} from '@/lib/backups'
import { previewRestore, restoreBackup, type RestorePreview, type RestoreSummary } from '@/app/dashboard/[guildId]/(management)/backups/actions'
import { BackupIcon } from './icons'
import { DiffView } from './DiffView'

export function RestoreWizard({
  guildId,
  backup,
  onClose,
  onDone,
}: {
  guildId: string
  backup: ServerBackup
  onClose: () => void
  onDone: () => void
}) {
  const present = sectionKeysPresent(backup.sections)
  const restorable = present.filter(isRestorable)
  const snapshotOnly = present.filter((k) => !isRestorable(k))

  const [selected, setSelected] = useState<BackupSectionKey[]>(restorable)
  const [pruneExtras, setPruneExtras] = useState(false)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [previewing, startPreview] = useTransition()
  const [restoring, startRestore] = useTransition()
  const [result, setResult] = useState<RestoreSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmArmed, setConfirmArmed] = useState(false)

  const touchesStructure = selected.includes('roles') || selected.includes('channels')

  const runPreview = useCallback(
    (keys: BackupSectionKey[], prune: boolean) => {
      if (keys.length === 0) {
        setPreview(null)
        return
      }
      setError(null)
      startPreview(async () => {
        const res = await previewRestore(guildId, backup.id, keys, prune)
        if (res.ok) setPreview(res.data)
        else setError(res.error)
      })
    },
    [guildId, backup.id],
  )

  // Preview on open + whenever the selection or the prune toggle changes (the
  // diff is what "changes that will occur" means, so it must track the toggles).
  // Debounced so rapid toggling collapses into one server call — each preview
  // re-verifies Discord access, and that endpoint is rate-limited.
  useEffect(() => {
    setConfirmArmed(false)
    const t = setTimeout(() => runPreview(selected, pruneExtras), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, pruneExtras])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !restoring) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [restoring, onClose])

  const toggle = (key: BackupSectionKey) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  function handleRestore() {
    if (selected.length === 0) return
    setError(null)
    startRestore(async () => {
      const res = await restoreBackup(guildId, backup.id, selected, pruneExtras)
      if (res.ok) {
        setResult(res.data)
        onDone()
      } else {
        setError(res.error)
      }
    })
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !restoring && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Restore backup"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            <RotateCcw size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-foreground">
              {result ? 'Restore complete' : 'Restore from backup'}
            </h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              Backup #{backup.version} · {backup.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={restoring}
            className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {result ? (
            <ResultPanel result={result} />
          ) : (
            <>
              {/* Section selection */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  Sections to restore
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {restorable.map((key) => {
                    const meta = SECTION_META[key]
                    const on = selected.includes(key)
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
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">{meta.label}</span>
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
                {snapshotOnly.length > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
                    <ShieldQuestion size={13} className="mt-0.5 shrink-0" />
                    <span>
                      {snapshotOnly.map((k) => SECTION_META[k].label).join(', ')} {snapshotOnly.length === 1 ? 'is' : 'are'} captured
                      for the record but can&apos;t be auto-restored (time-sensitive live objects).
                    </span>
                  </p>
                )}
              </div>

              {/* Opt-in destructive prune — only relevant when restoring live
                  structure (roles/channels). Off by default; matches the
                  additive-safe baseline unless the admin asks for a full revert. */}
              {touchesStructure && (
                <button
                  type="button"
                  onClick={() => setPruneExtras((v) => !v)}
                  className="flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors"
                  style={{
                    borderColor: pruneExtras ? 'rgba(239,68,68,0.5)' : 'var(--line-strong)',
                    background: pruneExtras ? 'rgba(239,68,68,0.08)' : 'var(--panel)',
                  }}
                >
                  <span
                    className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded"
                    style={{
                      border: `1.5px solid ${pruneExtras ? '#dc2626' : 'var(--line-strong)'}`,
                      background: pruneExtras ? '#dc2626' : 'transparent',
                    }}
                  >
                    {pruneExtras && <Check size={11} color="white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      Remove roles &amp; channels not in this backup
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      A true revert: deletes anything created after this backup. Deleting a channel also deletes its
                      messages — this can&apos;t be undone.
                    </span>
                  </span>
                </button>
              )}

              {/* Preview */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  Changes that will occur
                </p>
                {previewing ? (
                  <div className="flex items-center gap-2 rounded-lg border px-3 py-4 text-sm text-muted-foreground" style={{ borderColor: 'var(--line-strong)' }}>
                    <Loader2 size={14} className="animate-spin" /> Comparing the backup against your live server…
                  </div>
                ) : selected.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Select at least one section to preview the restore.</p>
                ) : preview ? (
                  <DiffView
                    diff={preview.diff}
                    addedLabel="Will create"
                    modifiedLabel="Will overwrite"
                    removedLabel="Only live"
                    emptyText="Your server already matches this backup for the selected sections."
                  />
                ) : null}
              </div>

              {/* Warnings */}
              {preview && preview.warnings.length > 0 && (
                <div
                  className="space-y-1.5 rounded-lg border px-3 py-2.5 text-xs"
                  style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}
                >
                  {preview.warnings.map((w, i) => (
                    <p key={i} className="flex items-start gap-1.5">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </p>
                  ))}
                </div>
              )}
            </>
          )}

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

        {/* Footer */}
        <div
          className="flex shrink-0 items-center justify-between gap-2 border-t px-5 py-3"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
        >
          {result ? (
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-lg px-4 py-1.5 text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
            >
              Done
            </button>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">
                {selected.length} section{selected.length === 1 ? '' : 's'} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={restoring}
                  className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                  style={{ borderColor: 'var(--line-strong)' }}
                >
                  Cancel
                </button>
                {confirmArmed ? (
                  <button
                    type="button"
                    onClick={handleRestore}
                    disabled={restoring || selected.length === 0}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50"
                    style={{ background: '#dc2626' }}
                  >
                    {restoring ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    {restoring ? 'Restoring…' : 'Confirm restore'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmArmed(true)}
                    disabled={previewing || selected.length === 0}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50"
                    style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
                  >
                    <RotateCcw size={13} /> Restore…
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ResultPanel({ result }: { result: RestoreSummary }) {
  return (
    <div className="space-y-3">
      <div
        className="flex items-center gap-2 rounded-lg border px-3 py-3 text-sm"
        style={{ borderColor: 'rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)', color: '#22c55e' }}
      >
        <Check size={15} /> Restore applied successfully.
      </div>
      <div className="space-y-1.5">
        {result.applied.map((a) => (
          <div
            key={a.key}
            className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
          >
            <span className="font-medium text-foreground">{a.label}</span>
            <span className="text-xs text-muted-foreground">{a.detail}</span>
          </div>
        ))}
      </div>
      {result.warnings.length > 0 && (
        <div
          className="space-y-1.5 rounded-lg border px-3 py-2.5 text-xs"
          style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}
        >
          {result.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{w}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
