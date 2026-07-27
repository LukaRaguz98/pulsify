'use client'

import { ArrowUpRight, X } from 'lucide-react'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import {
  CATEGORY_LABELS,
  SOURCE_LABELS,
  TARGET_TYPE_LABELS,
  diffValues,
  eventLabel,
  formatActor,
  formatFieldName,
  formatValue,
  moduleLabel,
  modulePath,
  type TimelineEvent,
} from '@/lib/timeline'
import { CategoryChip, SOURCE_ICON, TimelineMarker, eventIcon } from './timeline-style'

type Props = {
  event: TimelineEvent
  guildId: string
  onClose: () => void
  onNavigate: (href: string) => void
  /** Filter the feed down to one actor / member, straight from the drawer. */
  onFilterActor: (actorId: string) => void
  onFilterMember: (memberId: string) => void
}

/**
 * The expanded event.
 *
 * This is where an investigation actually happens, so it leads with the diff —
 * previous value against new value, field by field — then the people involved,
 * then the raw metadata for the rare case where the rendered view isn't
 * enough. Every identity in here is a jumping-off point: clicking an actor or
 * an affected member re-filters the feed around them.
 */
export function TimelineDetail({
  event,
  guildId,
  onClose,
  onNavigate,
  onFilterActor,
  onFilterMember,
}: Props) {
  useDialogDismiss(onClose)

  const diffs = diffValues(event.previousValue, event.newValue)
  const modulePage = modulePath(guildId, event.module)
  const metadataKeys = Object.keys(event.metadata ?? {})

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="History event details"
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <TimelineMarker category={event.category} severity={event.severity}>
            {eventIcon(event)}
          </TimelineMarker>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 font-semibold text-foreground">{event.title}</h2>
              <CategoryChip category={event.category} label={CATEGORY_LABELS[event.category]} />
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
              <span>{new Date(event.createdAt).toLocaleString()}</span>
              <span>·</span>
              <span>{eventLabel(event.eventType)}</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                {SOURCE_ICON[event.source]}
                {SOURCE_LABELS[event.source]}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground transition hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {event.description && (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{event.description}</p>
          )}

          {/* What changed */}
          {diffs.length > 0 && (
            <Block title="What changed">
              <ul className="space-y-2">
                {diffs.map((diff) => (
                  <li
                    key={diff.field}
                    className="rounded-lg border p-3"
                    style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                      {formatFieldName(diff.field)}
                    </p>
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                      <ValueBox label="Previous" value={formatValue(diff.previous)} tone="previous" />
                      <ValueBox label="New" value={formatValue(diff.next)} tone="next" />
                    </div>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {/* Who and what */}
          <Block title="Details">
            <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <Row label="Actor">
                {event.actor.id ? (
                  <button
                    type="button"
                    onClick={() => onFilterActor(event.actor.id!)}
                    className="text-left font-medium transition-colors hover:underline"
                    style={{ color: 'var(--p-1)' }}
                    title="Show everything this administrator did"
                  >
                    {formatActor(event.actor)}
                  </button>
                ) : (
                  <span className="text-foreground">{formatActor(event.actor)}</span>
                )}
              </Row>
              <Row label="Affected object">
                {event.targetName || event.targetId ? (
                  <span className="text-foreground">
                    {event.targetName ?? event.targetId}
                    {event.targetType && (
                      <span style={{ color: 'var(--text-3)' }}> · {TARGET_TYPE_LABELS[event.targetType]}</span>
                    )}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-3)' }}>—</span>
                )}
              </Row>
              <Row label="Related module">
                {event.module ? (
                  modulePage ? (
                    <button
                      type="button"
                      onClick={() => onNavigate(modulePage)}
                      className="inline-flex items-center gap-1 font-medium transition-colors hover:underline"
                      style={{ color: 'var(--p-1)' }}
                    >
                      {moduleLabel(event.module)}
                      <ArrowUpRight size={11} />
                    </button>
                  ) : (
                    <span className="text-foreground">{moduleLabel(event.module)}</span>
                  )
                ) : (
                  <span style={{ color: 'var(--text-3)' }}>—</span>
                )}
              </Row>
              <Row label="Event type">
                <span className="font-mono text-foreground">{event.eventType}</span>
              </Row>
              {event.targetId && (
                <Row label="Object ID">
                  <span className="font-mono text-foreground">{event.targetId}</span>
                </Row>
              )}
              {event.actor.id && (
                <Row label="Actor ID">
                  <span className="font-mono text-foreground">{event.actor.id}</span>
                </Row>
              )}
            </dl>
          </Block>

          {/* Affected users */}
          {event.affectedUsers.length > 0 && (
            <Block title={`Affected users (${event.affectedUsers.length})`}>
              <div className="flex flex-wrap gap-1.5">
                {event.affectedUsers.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => onFilterMember(user.id)}
                    className="rounded-full border px-2.5 py-1 text-xs transition-colors"
                    style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                    title="Show everything about this member"
                  >
                    {user.name ?? user.id}
                  </button>
                ))}
              </div>
            </Block>
          )}

          {/* Raw metadata — the escape hatch when the rendered view isn't enough */}
          {metadataKeys.length > 0 && (
            <Block title="Additional metadata">
              <pre
                className="overflow-x-auto rounded-lg border p-3 text-[11px] leading-relaxed"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              >
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </Block>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
        >
          {event.targetType === 'member' && event.targetId && (
            <button
              type="button"
              onClick={() => onNavigate(`/dashboard/${guildId}/members/${event.targetId}`)}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium transition"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              Open member
            </button>
          )}
          {event.link && (
            <button
              type="button"
              onClick={() => onNavigate(event.link!)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition"
              style={{ background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)' }}
            >
              Open
              <ArrowUpRight size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
        {title}
      </h3>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
        {label}
      </dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  )
}

/** Before/after pair. The old value reads as struck-through history. */
function ValueBox({ label, value, tone }: { label: string; value: string; tone: 'previous' | 'next' }) {
  const color = tone === 'previous' ? 'var(--text-3)' : 'var(--text)'
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
        {label}
      </p>
      <p
        className="mt-0.5 break-words text-xs"
        style={{ color, textDecoration: tone === 'previous' ? 'line-through' : undefined }}
      >
        {value}
      </p>
    </div>
  )
}
