'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, AlertCircle, Loader2, FileJson, Check, AlertTriangle } from 'lucide-react'
import {
  validateTemplateImport,
  SECTION_META,
  sectionKeysPresent,
  type ImportResult,
} from '@/lib/templates'
import { importTemplate } from '@/app/dashboard/[guildId]/templates/actions'
import { Modal } from './Modal'
import { TemplateIcon } from './icons'

type Props = {
  guildId: string
  onClose: () => void
  onImported: () => void
}

export function TemplateImportPanel({ guildId, onClose, onImported }: Props) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<Extract<ImportResult, { ok: true }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
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
      setError('That isn\'t valid JSON.')
      return
    }
    const result = validateTemplateImport(obj)
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

  async function onImport() {
    if (!parsed) return
    setSaving(true)
    setError(null)
    let obj: unknown
    try {
      obj = JSON.parse(text)
    } catch {
      setSaving(false)
      setError('That isn\'t valid JSON.')
      return
    }
    const res = await importTemplate(guildId, obj)
    setSaving(false)
    if (res.ok) {
      router.refresh()
      onImported()
    } else {
      setError(res.error)
    }
  }

  return (
    <Modal
      title="Import template"
      subtitle="Paste exported JSON or choose a .json file."
      icon={<Upload size={17} />}
      busy={saving}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            Cancel
          </button>
          <button
            onClick={onImport}
            disabled={saving || !parsed}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            Import to library
          </button>
        </>
      }
    >
      <div className="space-y-4">
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
          placeholder='{ "pulsifyTemplate": 1, "name": "...", "sections": { ... } }'
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
          <div
            className="rounded-lg border p-3"
            style={{ borderColor: 'rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.06)' }}
          >
            <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Check size={14} style={{ color: '#4ade80' }} /> {parsed.value.name}
            </p>
            {parsed.value.description && (
              <p className="mt-1 text-xs" style={{ color: 'var(--text-2)' }}>
                {parsed.value.description}
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
                      <TemplateIcon name={meta.icon} size={10} />
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
    </Modal>
  )
}
