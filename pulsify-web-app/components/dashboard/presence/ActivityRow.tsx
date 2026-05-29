'use client'

import { GripVertical, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import {
  ACTIVITY_KINDS,
  PLACEHOLDERS,
  PRESENCE_LIMITS,
  activityVerb,
  resolveSample,
  type PresenceActivity,
  type ActivityKind,
} from '@/lib/presence'
import { PresenceIcon } from './icons'

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

type Props = {
  activity: PresenceActivity
  index: number
  total: number
  disabled?: boolean
  onChange: (next: PresenceActivity) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}

export function ActivityRow({ activity, index, total, disabled, onChange, onRemove, onMove }: Props) {
  const set = (patch: Partial<PresenceActivity>) => onChange({ ...activity, ...patch })

  const insertPlaceholder = (token: string) => {
    if (disabled) return
    const next = `${activity.text}${activity.text && !activity.text.endsWith(' ') ? ' ' : ''}${token}`.slice(
      0,
      PRESENCE_LIMITS.maxTextLength,
    )
    set({ text: next })
  }

  const preview = resolveSample(activity.text)
  const verb = activityVerb(activity.kind)

  return (
    <div className="rounded-xl border p-3" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="flex items-start gap-2">
        {/* Reorder handle */}
        <div className="flex flex-col items-center pt-1.5" style={{ color: 'var(--text-3)' }}>
          <GripVertical size={14} />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Kind */}
            <select
              value={activity.kind}
              disabled={disabled}
              onChange={(e) => set({ kind: e.target.value as ActivityKind })}
              className="rounded-lg border px-2.5 py-1.5 text-sm outline-none disabled:opacity-60"
              style={fieldStyle}
            >
              {ACTIVITY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>

            {/* Emoji (optional) */}
            <input
              type="text"
              value={activity.emoji ?? ''}
              disabled={disabled}
              onChange={(e) => set({ emoji: e.target.value })}
              placeholder="emoji"
              className="w-16 rounded-lg border px-2 py-1.5 text-center text-sm outline-none disabled:opacity-60"
              style={fieldStyle}
              maxLength={16}
            />

            {/* Text */}
            <input
              type="text"
              value={activity.text}
              disabled={disabled}
              onChange={(e) => set({ text: e.target.value.slice(0, PRESENCE_LIMITS.maxTextLength) })}
              placeholder={activity.kind === 'custom' ? 'Custom status text' : 'Activity text'}
              className="min-w-[140px] flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none disabled:opacity-60"
              style={fieldStyle}
              maxLength={PRESENCE_LIMITS.maxTextLength}
            />
          </div>

          {/* Stream URL — only for streaming */}
          {activity.kind === 'streaming' && (
            <input
              type="url"
              value={activity.stream_url ?? ''}
              disabled={disabled}
              onChange={(e) => set({ stream_url: e.target.value })}
              placeholder="https://twitch.tv/…"
              className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none disabled:opacity-60"
              style={fieldStyle}
            />
          )}

          {/* Placeholder insert chips */}
          {!disabled && (
            <div className="flex flex-wrap gap-1">
              {PLACEHOLDERS.map((p) => (
                <button
                  key={p.token}
                  type="button"
                  onClick={() => insertPlaceholder(p.token)}
                  title={p.description}
                  className="rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
                >
                  {p.token}
                </button>
              ))}
            </div>
          )}

          {/* Resolved preview line */}
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            <PresenceIcon name={ACTIVITY_KINDS.find((k) => k.value === activity.kind)?.icon ?? 'Sparkles'} size={11} />{' '}
            <span className="align-middle">
              {verb ? `${verb} ` : ''}
              {activity.emoji ? `${activity.emoji} ` : ''}
              {preview || <em>(empty)</em>}
            </span>
          </p>
        </div>

        {/* Row controls */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={disabled || index === 0}
            className="rounded p-1 transition-colors disabled:opacity-30"
            style={{ color: 'var(--text-3)' }}
            aria-label="Move up"
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={disabled || index === total - 1}
            className="rounded p-1 transition-colors disabled:opacity-30"
            style={{ color: 'var(--text-3)' }}
            aria-label="Move down"
          >
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="rounded p-1 transition-colors disabled:opacity-30"
            style={{ color: '#f23f43' }}
            aria-label="Remove activity"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
