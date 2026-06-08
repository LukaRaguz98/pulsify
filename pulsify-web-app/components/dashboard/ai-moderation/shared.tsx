'use client'

import { Sparkles, ShieldQuestion, Cpu, ScanSearch } from 'lucide-react'
import {
  CATEGORY_COLORS,
  CONFIDENCE_COLORS,
  CONFIDENCE_LABELS,
  confidenceLabel as deriveConfidenceLabel,
  type CategoryId,
  type ConfidenceLabel,
} from '@/lib/ai-moderation'
import type { AIModerationEventRow } from '@/app/api/guilds/[guildId]/ai-moderation/events/route'

/**
 * Shared Pulse Guard presentational pieces (PULSIFY-41). The confidence badge,
 * structured signal list and moderator-feedback control are used across the
 * review queue, history detail and the overview verdict panel so the
 * "why was this flagged / how sure are we" story reads the same everywhere.
 */

/** Resolve a row's confidence band, falling back to deriving it from the score. */
export function rowConfidenceLabel(e: Pick<AIModerationEventRow, 'confidence' | 'confidence_label'>): ConfidenceLabel {
  return (e.confidence_label as ConfidenceLabel | null) ?? deriveConfidenceLabel(e.confidence)
}

export function ConfidenceBadge({
  confidence,
  label,
  className,
}: {
  confidence: number
  label: ConfidenceLabel
  className?: string
}) {
  const color = CONFIDENCE_COLORS[label]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-mono ${className ?? ''}`}
      style={{ background: `${color}1f`, color }}
      title={`${CONFIDENCE_LABELS[label]} — ${Math.round(confidence * 100)}%`}
    >
      {Math.round(confidence * 100)}% · {CONFIDENCE_LABELS[label]}
    </span>
  )
}

type Signal = AIModerationEventRow['signals'][number]

/**
 * Render the structured evidence behind a detection. Heuristic signals carry a
 * scan icon, the AI model's contributions a chip icon, so a moderator can tell
 * deterministic rule hits from the model's judgement at a glance.
 */
export function SignalList({ signals, max = 6 }: { signals: Signal[]; max?: number }) {
  if (!signals || signals.length === 0) return null
  const shown = signals.slice(0, max)
  const extra = signals.length - shown.length
  return (
    <ul className="space-y-1">
      {shown.map((s, i) => {
        const color = CATEGORY_COLORS[s.category as CategoryId] ?? 'var(--text-3)'
        return (
          <li key={`${s.category}-${i}`} className="flex items-center gap-2 text-[11px]">
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
              style={{ background: `${color}1f`, color }}
              title={s.source === 'ai' ? 'Pulse Guard model' : 'Deterministic rule'}
            >
              {s.source === 'ai' ? <Cpu size={9} /> : <ScanSearch size={9} />}
            </span>
            <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-2)' }}>{s.label}</span>
            <span className="font-mono shrink-0" style={{ color: 'var(--text-3)' }}>
              {Math.round(s.weight * 100)}%
            </span>
          </li>
        )
      })}
      {extra > 0 && (
        <li className="text-[10px]" style={{ color: 'var(--text-3)' }}>+{extra} more signal{extra === 1 ? '' : 's'}</li>
      )}
    </ul>
  )
}

/**
 * Moderator override control — "was Pulse Guard right?". Two segmented buttons
 * that toggle the stored verdict (correct / incorrect). Pure presentation; the
 * parent owns the server action + busy state.
 */
export function VerdictFeedback({
  verdict,
  busy,
  onSet,
  compact,
}: {
  verdict: 'correct' | 'incorrect' | null
  busy?: boolean
  onSet: (v: 'correct' | 'incorrect') => void
  compact?: boolean
}) {
  return (
    <div className="inline-flex items-center gap-1" title="Tell Pulse Guard whether this detection was right">
      {!compact && (
        <span className="mr-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
          <ShieldQuestion size={11} /> Accurate?
        </span>
      )}
      <FeedbackBtn
        label="Correct"
        active={verdict === 'correct'}
        accent="#22c55e"
        disabled={busy}
        onClick={() => onSet('correct')}
      />
      <FeedbackBtn
        label="False positive"
        active={verdict === 'incorrect'}
        accent="#f87171"
        disabled={busy}
        onClick={() => onSet('incorrect')}
      />
    </div>
  )
}

function FeedbackBtn({
  label,
  active,
  accent,
  disabled,
  onClick,
}: {
  label: string
  active: boolean
  accent: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition disabled:opacity-50"
      style={{
        borderColor: active ? accent : 'var(--line-strong)',
        background: active ? `${accent}1f` : 'transparent',
        color: active ? accent : 'var(--text-3)',
      }}
    >
      {label}
    </button>
  )
}

/** Small "Pulse Guard model contributed" hint for verdicts where the LLM ran. */
export function AiContributionHint() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-3)' }}>
      <Sparkles size={9} /> Pulse Guard model
    </span>
  )
}
