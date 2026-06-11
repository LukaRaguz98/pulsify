'use client'

import { useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, FileJson, Loader2, Check, AlertCircle, AlertTriangle } from 'lucide-react'
import {
  validateBackupImport,
  SECTION_META,
  sectionKeysPresent,
  type BackupImportResult,
} from '@/lib/backups'
import { importBackup } from '@/app/dashboard/[guildId]/(management)/backups/actions'
import { BackupIcon } from './icons'

export function BackupImportPanel({
  guildId,
  onClose,
  onImported,
}: {
  guildId: string
  onClose: () => void
  onImported: () => void
}) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<Extract<BackupImportResult, { ok: true }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  function validate(raw: string) {
    setText(raw)
    setError(null)
    setParsed(null)
    if (!raw.trim()) return
    let obj: unknown
    try {
      obj = JSON.parse(raw)
    } catch {
      setError("That isn't valid JSON.")
      return
    }
    const result = validateBackupImport(obj)
    if (result.ok) setParsed(result)
    else setError(result.error)
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => validate(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  function onImport() {
    if (!parsed) return
    setError(null)
    let obj: unknown
    try {
      obj = JSON.parse(text)
    } catch {
      setError("That isn't valid JSON.")
      return
    }
    startSave(async () => {
      const res = await importBackup(guildId, obj)
      if (res.ok) onImported()
      else setError(res.error)
    })
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import backup"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex shrink-0 items-start gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            <Upload size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-foreground">Import backup</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Paste exported JSON or choose a <code>.json</code> file — then restore it here to clone that server&apos;s setup.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <FileJson size={14} /> Choose file
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} className="hidden" />
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              or paste below
            </span>
          </div>

          <textarea
            value={text}
            onChange={(e) => validate(e.target.value)}
            rows={8}
            placeholder='{ "pulsifyBackup": 1, "name": "...", "sections": { ... } }'
            spellCheck={false}
            className="w-full resize-none rounded-lg border px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />

          {error && (
            <div
              className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
              style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
            >
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {parsed && (
            <div className="rounded-lg border p-3" style={{ borderColor: 'rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.06)' }}>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Check size={14} style={{ color: '#4ade80' }} /> {parsed.value.name}
              </p>
              {parsed.value.sourceGuildName && (
                <p className="mt-1 text-xs" style={{ color: 'var(--text-2)' }}>
                  From “{parsed.value.sourceGuildName}”
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sectionKeysPresent(parsed.value.sections).map((k) => {
                  const meta = SECTION_META[k]
                  return (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ background: 'var(--bg-2)', color: 'var(--text-2)', border: '1px solid var(--line)' }}
                    >
                      <span style={{ color: meta.accent }}>
                        <BackupIcon name={meta.icon} size={10} />
                      </span>
                      {meta.label}
                    </span>
                  )
                })}
              </div>
              {parsed.warnings.length > 0 && (
                <div className="mt-2 space-y-1">
                  {parsed.warnings.map((w, i) => (
                    <p key={i} className="flex items-start gap-1.5 text-xs" style={{ color: '#fbbf24' }}>
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </p>
                  ))}
                </div>
              )}
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
            disabled={saving}
            className="rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onImport}
            disabled={saving || !parsed}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            Import to library
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
