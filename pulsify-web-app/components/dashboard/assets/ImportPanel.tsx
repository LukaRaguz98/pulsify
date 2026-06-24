'use client'

import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, UploadCloud, Trash2, Loader2, AlertTriangle, CheckCircle2, ImageOff } from 'lucide-react'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import { sanitizeExpressionName } from '@/lib/discord'
import type { AssetKind } from '@/lib/assets'

type Props = {
  kind: AssetKind
  guildId: string
  existingNames: Set<string>
  /** Remaining slots for this category; uploads beyond it are flagged. */
  freeSlots: number
  onClose: () => void
  onUploaded: () => void
}

type QueueItem = {
  key: string
  file: File
  name: string
  dataUrl: string
  preview: string | null
  /** Pre-flight validation problem (blocks upload). */
  error: string | null
  status: 'idle' | 'uploading' | 'done' | 'failed'
  serverError?: string
}

// Per-kind upload constraints, mirrored from Discord's limits.
const RULES: Record<AssetKind, { accept: string; maxBytes: number; mimes: RegExp; hint: string }> = {
  emoji: { accept: 'image/png,image/jpeg,image/gif', maxBytes: 256 * 1024, mimes: /^image\/(png|jpeg|gif)$/, hint: 'PNG, JPEG or GIF · max 256 KB' },
  sticker: { accept: 'image/png,image/gif', maxBytes: 512 * 1024, mimes: /^image\/(png|gif|apng)$/, hint: 'PNG, APNG or GIF · 320×320 · max 512 KB' },
  sound: { accept: 'audio/mpeg,audio/ogg', maxBytes: 512 * 1024, mimes: /^audio\/(mpeg|mp3|ogg)$/, hint: 'MP3 or OGG · max 512 KB · 5.2s' },
}

const TITLES: Record<AssetKind, string> = { emoji: 'Import emojis', sticker: 'Import stickers', sound: 'Import sounds' }

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

export function ImportPanel({ kind, guildId, existingNames, freeSlots, onClose, onUploaded }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [anyUploaded, setAnyUploaded] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rule = RULES[kind]

  useDialogDismiss(() => { if (anyUploaded) onUploaded(); onClose() }, busy)

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files)
    const built: QueueItem[] = []
    for (const file of list) {
      let error: string | null = null
      if (!rule.mimes.test(file.type)) error = 'Unsupported file type.'
      else if (file.size > rule.maxBytes) error = `Too large (${(file.size / 1024).toFixed(0)} KB).`
      let dataUrl = ''
      try {
        dataUrl = await readAsDataUrl(file)
      } catch {
        error = 'Could not read file.'
      }
      const baseName = file.name.replace(/\.[^.]+$/, '')
      const name = kind === 'sticker' ? baseName.slice(0, 30) : sanitizeExpressionName(baseName)
      built.push({
        key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        name,
        dataUrl,
        preview: kind === 'sound' ? null : dataUrl,
        error,
        status: 'idle',
      })
    }
    setQueue((prev) => [...prev, ...built])
  }, [kind, rule])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files)
  }

  function updateName(key: string, name: string) {
    setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, name } : q)))
  }

  function remove(key: string) {
    setQueue((prev) => prev.filter((q) => q.key !== key))
  }

  async function uploadOne(q: QueueItem): Promise<boolean> {
    const finalName = kind === 'sticker' ? q.name.trim().slice(0, 30) : sanitizeExpressionName(q.name)
    let url: string
    let body: Record<string, unknown>
    if (kind === 'emoji') {
      url = `/api/discord/guild/${guildId}/assets/emojis`
      body = { name: finalName, image: q.dataUrl }
    } else if (kind === 'sticker') {
      url = `/api/discord/guild/${guildId}/assets/stickers`
      body = { name: finalName, description: '', tags: finalName, file: q.dataUrl }
    } else {
      url = `/api/discord/guild/${guildId}/assets/soundboard`
      body = { name: finalName, sound: q.dataUrl, volume: 1 }
    }
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) return true
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    setQueue((prev) => prev.map((p) => (p.key === q.key ? { ...p, status: 'failed', serverError: data.error ?? 'Upload failed.' } : p)))
    return false
  }

  async function uploadAll() {
    const valid = queue.filter((q) => !q.error && q.status !== 'done')
    if (valid.length === 0) return
    setBusy(true)
    for (const q of valid) {
      setQueue((prev) => prev.map((p) => (p.key === q.key ? { ...p, status: 'uploading', serverError: undefined } : p)))
      // Sequential to respect Discord's tight expression rate limits.
      const ok = await uploadOne(q)
      if (ok) {
        setAnyUploaded(true)
        setQueue((prev) => prev.map((p) => (p.key === q.key ? { ...p, status: 'done' } : p)))
      }
    }
    setBusy(false)
  }

  function handleClose() {
    if (busy) return
    if (anyUploaded) onUploaded()
    onClose()
  }

  if (typeof document === 'undefined') return null

  const uploadable = queue.filter((q) => !q.error && q.status !== 'done')
  const overflow = uploadable.length > freeSlots

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[kind]}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div>
            <h2 className="font-semibold text-foreground">{TITLES[kind]}</h2>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{rule.hint} · {freeSlots} slot{freeSlots === 1 ? '' : 's'} free</p>
          </div>
          <button type="button" onClick={handleClose} disabled={busy} className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors"
            style={{
              borderColor: dragOver ? 'var(--p-1)' : 'var(--line-strong)',
              background: dragOver ? 'var(--p-soft)' : 'var(--bg-2)',
            }}
          >
            <UploadCloud size={26} style={{ color: 'var(--p-1)' }} />
            <p className="text-sm font-medium text-foreground">Drop files here or click to browse</p>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{rule.hint}</p>
            <input
              ref={inputRef}
              type="file"
              accept={rule.accept}
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }}
            />
          </div>

          {overflow && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>You&apos;re adding {uploadable.length} but only {freeSlots} slot{freeSlots === 1 ? '' : 's'} remain. Discord will reject the overflow.</span>
            </div>
          )}

          {/* Queue */}
          {queue.length > 0 && (
            <div className="mt-4 space-y-2">
              {queue.map((q) => {
                const dup = existingNames.has((kind === 'sticker' ? q.name.trim() : sanitizeExpressionName(q.name)).toLowerCase())
                return (
                  <div key={q.key} className="flex items-center gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md" style={{ background: 'var(--panel)' }}>
                      {q.preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={q.preview} alt="" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <ImageOff size={16} style={{ color: 'var(--text-3)' }} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <input
                        value={q.name}
                        onChange={(e) => updateName(q.key, e.target.value)}
                        disabled={busy || q.status === 'done'}
                        className="w-full rounded border bg-transparent px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1"
                        style={{ borderColor: 'var(--line-strong)' }}
                      />
                      <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                        {q.error ? (
                          <span style={{ color: '#f87171' }}>{q.error}</span>
                        ) : q.serverError ? (
                          <span style={{ color: '#f87171' }}>{q.serverError}</span>
                        ) : dup ? (
                          <span style={{ color: '#f59e0b' }}>Name already exists</span>
                        ) : (
                          <span style={{ color: 'var(--text-3)' }}>{(q.file.size / 1024).toFixed(0)} KB</span>
                        )}
                      </div>
                    </div>
                    {q.status === 'done' ? (
                      <CheckCircle2 size={16} style={{ color: '#34d399' }} />
                    ) : q.status === 'uploading' ? (
                      <Loader2 size={16} className="animate-spin" style={{ color: 'var(--p-1)' }} />
                    ) : (
                      <button type="button" onClick={() => remove(q.key)} disabled={busy} className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40" aria-label="Remove">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          <button type="button" onClick={handleClose} disabled={busy} className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50" style={{ borderColor: 'var(--line-strong)' }}>
            {anyUploaded ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={uploadAll}
            disabled={busy || uploadable.length === 0}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            Upload {uploadable.length > 0 ? uploadable.length : ''}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
