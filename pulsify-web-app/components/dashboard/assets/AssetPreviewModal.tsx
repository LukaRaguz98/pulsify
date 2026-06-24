'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Pencil, Copy, Download, Trash2, Play, Pause, ImageOff, Volume2, Loader2 } from 'lucide-react'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import type { AssetItem } from './types'

type Props = {
  item: AssetItem
  busy: boolean
  onClose: () => void
  onRename: (item: AssetItem) => void
  onDuplicate: (item: AssetItem) => void
  onExport: (item: AssetItem) => void
  onDelete: (item: AssetItem) => void
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground">{value}</span>
    </div>
  )
}

export function AssetPreviewModal({ item, busy, onClose, onRename, onDuplicate, onExport, onDelete }: Props) {
  useDialogDismiss(onClose, busy)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)

  if (typeof document === 'undefined') return null

  function togglePlay() {
    const el = audioRef.current
    if (!el) return
    if (playing) el.pause()
    else { el.currentTime = 0; void el.play().catch(() => setPlaying(false)) }
  }

  const created = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} details`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <h2 className="truncate font-semibold text-foreground">{item.name}</h2>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto">
          {/* Large preview */}
          <div className="flex items-center justify-center px-6 py-8" style={{ background: 'var(--bg-2)' }}>
            {item.kind === 'sound' && item.audioUrl ? (
              <div className="flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="flex h-16 w-16 items-center justify-center rounded-full transition-transform hover:scale-105"
                  style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  {playing ? <Pause size={26} /> : <Play size={26} className="ml-1" />}
                </button>
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>{playing ? 'Playing…' : 'Tap to preview'}</span>
                <audio ref={audioRef} src={item.audioUrl} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
              </div>
            ) : item.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.previewUrl} alt={item.name} className="max-h-40 max-w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2" style={{ color: 'var(--text-3)' }}>
                {item.kind === 'sound' ? <Volume2 size={36} /> : <ImageOff size={36} />}
                <span className="text-xs">No preview available</span>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="divide-y px-5 py-3" style={{ borderColor: 'var(--line-strong)' }}>
            <MetaRow label="Type" value={item.typeLabel} />
            {item.kind === 'sticker' && item.description && <MetaRow label="Description" value={item.description} />}
            {item.kind === 'sticker' && item.tags && <MetaRow label="Tags" value={item.tags} />}
            {item.kind === 'sound' && item.volume != null && <MetaRow label="Volume" value={`${Math.round(item.volume * 100)}%`} />}
            {item.uploader && <MetaRow label="Uploaded by" value={item.uploader} />}
            {created && <MetaRow label="Created" value={created} />}
            <MetaRow label="Available" value={item.available ? 'Yes' : 'No'} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          <button
            type="button"
            onClick={() => onRename(item)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            <Pencil size={13} /> Rename
          </button>
          {item.kind === 'emoji' && (
            <button
              type="button"
              onClick={() => onDuplicate(item)}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)' }}
            >
              <Copy size={13} /> Duplicate
            </button>
          )}
          <button
            type="button"
            onClick={() => onExport(item)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            <Download size={13} /> Export
          </button>
          <button
            type="button"
            onClick={() => onDelete(item)}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
            style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)', color: '#f87171' }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
