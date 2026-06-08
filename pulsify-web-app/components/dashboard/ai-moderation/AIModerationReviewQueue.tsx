'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  Check,
  ShieldAlert,
  ShieldCheck,
  Loader2,
  AlertCircle,
  Trash2,
  Clock,
  MessageSquareWarning,
  ListTree,
  X,
} from 'lucide-react'
import {
  AUTO_ACTION_LABELS,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type AutoAction,
  type CategoryId,
} from '@/lib/ai-moderation'
import type { AIModerationEventRow } from '@/app/api/guilds/[guildId]/ai-moderation/events/route'
import {
  bulkReviewModerationEvents,
  executeModerationAction,
  reviewModerationEvent,
  setModeratorVerdict,
} from '@/app/dashboard/[guildId]/ai-moderation/actions'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfidenceBadge, SignalList, VerdictFeedback, rowConfidenceLabel } from './shared'

type Props = {
  guildId: string
  events: AIModerationEventRow[]
  onChange: () => void
}

export function AIModerationReviewQueue({ guildId, events, onChange }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // Optimistic override state so a "correct"/"false positive" tap reflects
  // instantly while the server action runs (the refetch reconciles after).
  const [verdicts, setVerdicts] = useState<Record<string, 'correct' | 'incorrect' | null>>({})

  function handleVerdict(event: AIModerationEventRow, verdict: 'correct' | 'incorrect') {
    const current = verdicts[event.id] ?? event.moderator_verdict
    const optimistic = current === verdict ? null : verdict
    setVerdicts((prev) => ({ ...prev, [event.id]: optimistic }))
    setBusyId(event.id)
    startTransition(async () => {
      const res = await setModeratorVerdict(guildId, event.id, verdict)
      setBusyId(null)
      if (!res.ok) {
        setError(res.error)
        setVerdicts((prev) => ({ ...prev, [event.id]: current }))
        return
      }
      // A confirmed false positive is dismissed server-side; refresh the queue.
      if (optimistic === 'incorrect') onChange()
    })
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll(value: boolean) {
    setSelected(value ? new Set(events.map((e) => e.id)) : new Set())
  }

  function handleReview(id: string, decision: 'resolved' | 'dismissed') {
    setBusyId(id)
    setError(null)
    startTransition(async () => {
      const res = await reviewModerationEvent(guildId, id, decision)
      setBusyId(null)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      onChange()
    })
  }

  function handleAction(event: AIModerationEventRow, action: AutoAction) {
    setBusyId(event.id)
    setError(null)
    startTransition(async () => {
      const res = await executeModerationAction(guildId, event.id, {
        action,
        channelId: event.channel_id,
        messageId: event.message_id,
        authorId: event.author_id,
      })
      setBusyId(null)
      if (!res.ok) {
        setError(res.error)
        return
      }
      onChange()
    })
  }

  function handleBulk(decision: 'resolved' | 'dismissed') {
    if (selected.size === 0) return
    setError(null)
    startTransition(async () => {
      const res = await bulkReviewModerationEvents(guildId, Array.from(selected), decision)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setSelected(new Set())
      onChange()
    })
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck size={36} />}
        title="Inbox zero"
        description="No flagged content waiting on review. Anything new will appear here in real time."
      />
    )
  }

  const allSelected = selected.size === events.length

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm"
        style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
      >
        <label className="flex items-center gap-2 text-foreground">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => selectAll(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span className="text-xs">
            {selected.size > 0 ? `${selected.size} selected` : `${events.length} pending`}
          </span>
        </label>
        <div className="flex items-center gap-2">
          <button
            disabled={selected.size === 0 || pending}
            onClick={() => handleBulk('resolved')}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <Check size={12} /> Mark resolved
          </button>
          <button
            disabled={selected.size === 0 || pending}
            onClick={() => handleBulk('dismissed')}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
          >
            <X size={12} /> Dismiss
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
          <AlertCircle size={13} className="shrink-0" />
          {error}
        </div>
      )}

      <ul className="space-y-3">
        {events.map((e) => {
          const isBusy = busyId === e.id
          const isSelected = selected.has(e.id)
          const category = (e.top_category as CategoryId | null) ?? null
          const verdict = e.id in verdicts ? verdicts[e.id] : e.moderator_verdict
          return (
            <li
              key={e.id}
              className="rounded-xl border p-4"
              style={{
                background: 'var(--panel)',
                borderColor: isSelected ? 'var(--p-1)' : 'var(--line-strong)',
              }}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(e.id)}
                  className="mt-1.5 h-3.5 w-3.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {category ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ background: `${CATEGORY_COLORS[category]}1f`, color: CATEGORY_COLORS[category] }}
                      >
                        <ShieldAlert size={11} /> {CATEGORY_LABELS[category]}
                      </span>
                    ) : null}
                    <ConfidenceBadge confidence={e.confidence} label={rowConfidenceLabel(e)} />
                    <span className="text-[11px] text-subtle">
                      {e.channel_name ? `#${e.channel_name}` : 'No channel'} ·{' '}
                      {e.author_name ?? e.author_id ?? 'unknown'}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-subtle">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                  </div>

                  <p className="mt-2 whitespace-pre-wrap break-words rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
                    {e.content}
                  </p>

                  {e.reasoning && (
                    <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
                      <span className="font-semibold" style={{ color: 'var(--text-2)' }}>Why: </span>
                      {e.reasoning}
                    </p>
                  )}

                  {e.signals && e.signals.length > 0 && (
                    <div className="mt-2 rounded-lg border px-3 py-2"
                      style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
                      <p className="mb-1.5 flex items-center gap-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                        <ListTree size={11} /> Detection signals
                      </p>
                      <SignalList signals={e.signals} />
                    </div>
                  )}

                  {/* Feedback + investigation row — separate from the action
                      buttons so "was this right?" reads as a distinct task. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"
                    style={{ borderColor: 'var(--line-strong)' }}>
                    <VerdictFeedback
                      verdict={verdict}
                      busy={isBusy}
                      onSet={(v) => handleVerdict(e, v)}
                    />
                    {e.author_id && (
                      <Link
                        href={`/dashboard/${guildId}/members/${e.author_id}`}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition"
                        style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
                      >
                        <ListTree size={11} /> Member history
                      </Link>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionBtn icon={<Trash2 size={12} />} label={AUTO_ACTION_LABELS.delete} disabled={isBusy || !e.message_id} onClick={() => handleAction(e, 'delete')} />
                    <ActionBtn icon={<MessageSquareWarning size={12} />} label={AUTO_ACTION_LABELS.warn} disabled={isBusy || !e.author_id} onClick={() => handleAction(e, 'warn')} />
                    <ActionBtn icon={<Clock size={12} />} label={AUTO_ACTION_LABELS.timeout} disabled={isBusy || !e.author_id} onClick={() => handleAction(e, 'timeout')} />
                    <div className="ml-auto flex items-center gap-2">
                      {isBusy && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
                      <button
                        onClick={() => handleReview(e.id, 'dismissed')}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
                        style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
                      >
                        <X size={11} /> Dismiss
                      </button>
                      <button
                        onClick={() => handleReview(e.id, 'resolved')}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold text-white transition disabled:opacity-50"
                        style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
                      >
                        <Check size={11} /> Resolve
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ActionBtn({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-40"
      style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
    >
      {icon}
      {label}
    </button>
  )
}
