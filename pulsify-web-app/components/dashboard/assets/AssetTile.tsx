'use client'

import { useRef, useState } from 'react'
import { Play, Pause, ImageOff, Volume2, Check } from 'lucide-react'
import type { AssetItem } from './types'

type Props = {
  item: AssetItem
  view: 'grid' | 'list'
  selected: boolean
  onToggleSelect: (id: string, kind: AssetItem['kind']) => void
  onOpen: (item: AssetItem) => void
}

/** Small inline play/pause control for soundboard tiles. */
function SoundButton({ url, size = 'md' }: { url: string; size?: 'sm' | 'md' }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const dim = size === 'sm' ? 'h-9 w-9' : 'h-12 w-12'

  function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
    } else {
      el.currentTime = 0
      void el.play().catch(() => setPlaying(false))
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause sound' : 'Play sound'}
        className={`flex ${dim} items-center justify-center rounded-full transition-transform hover:scale-105`}
        style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
      >
        {playing ? <Pause size={size === 'sm' ? 16 : 20} /> : <Play size={size === 'sm' ? 16 : 20} className="ml-0.5" />}
      </button>
      <audio
        ref={audioRef}
        src={url}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </>
  )
}

/** Renders the visual preview for an asset (image, lottie placeholder, or sound). */
function Preview({ item, big }: { item: AssetItem; big?: boolean }) {
  if (item.kind === 'sound' && item.audioUrl) {
    return <SoundButton url={item.audioUrl} size={big ? 'md' : 'sm'} />
  }
  if (item.previewUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.previewUrl}
        alt={item.name}
        loading="lazy"
        className="max-h-full max-w-full object-contain"
        style={{ imageRendering: 'auto' }}
      />
    )
  }
  // Lottie sticker or missing image — show a neutral placeholder.
  return (
    <div className="flex flex-col items-center gap-1" style={{ color: 'var(--text-3)' }}>
      {item.kind === 'sound' ? <Volume2 size={big ? 28 : 20} /> : <ImageOff size={big ? 28 : 20} />}
      {item.kind === 'sticker' && <span className="text-[10px] uppercase tracking-wide">{item.typeLabel}</span>}
    </div>
  )
}

export function AssetTile({ item, view, selected, onToggleSelect, onOpen }: Props) {
  if (view === 'list') {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(item)}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpen(item) }}
        className="flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors"
        style={{
          background: selected ? 'var(--p-soft)' : 'var(--panel)',
          borderColor: selected ? 'var(--p-1)' : 'var(--line-strong)',
        }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleSelect(item.id, item.kind) }}
          aria-label={selected ? 'Deselect' : 'Select'}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded border"
          style={{
            background: selected ? 'var(--p-1)' : 'transparent',
            borderColor: selected ? 'var(--p-1)' : 'var(--line-strong)',
            color: '#fff',
          }}
        >
          {selected && <Check size={13} />}
        </button>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md"
          style={{ background: 'var(--bg-2)' }}
        >
          <Preview item={item} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
          <p className="truncate text-xs" style={{ color: 'var(--text-3)' }}>
            {item.typeLabel}
            {item.kind === 'sound' && item.volume != null && ` · ${Math.round(item.volume * 100)}% vol`}
            {item.uploader && ` · by ${item.uploader}`}
          </p>
        </div>
        {!item.available && (
          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
            Unavailable
          </span>
        )}
      </div>
    )
  }

  // Grid card.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(item) }}
      className="group relative flex flex-col overflow-hidden rounded-xl border transition-all hover:-translate-y-0.5"
      style={{
        background: selected ? 'var(--p-soft)' : 'var(--panel)',
        borderColor: selected ? 'var(--p-1)' : 'var(--line-strong)',
      }}
    >
      {/* Selection checkbox — always visible once selected, on hover otherwise. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleSelect(item.id, item.kind) }}
        aria-label={selected ? 'Deselect' : 'Select'}
        className={`absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{
          background: selected ? 'var(--p-1)' : 'rgba(0,0,0,0.45)',
          borderColor: selected ? 'var(--p-1)' : 'var(--line-strong)',
          color: '#fff',
        }}
      >
        {selected && <Check size={13} />}
      </button>

      <div
        className="flex aspect-square items-center justify-center p-4"
        style={{ background: 'var(--bg-2)' }}
      >
        <Preview item={item} big />
      </div>
      <div className="flex flex-col gap-0.5 px-2.5 py-2">
        <p className="truncate text-xs font-medium text-foreground" title={item.name}>{item.name}</p>
        <span className="truncate text-[10px]" style={{ color: 'var(--text-3)' }}>
          {item.typeLabel}
        </span>
      </div>
    </div>
  )
}
