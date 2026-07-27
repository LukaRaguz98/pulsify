'use client'

import { ArrowUpRight, Maximize2 } from 'lucide-react'
import {
  CATEGORY_LABELS,
  SOURCE_LABELS,
  diffValues,
  eventLabel,
  formatActor,
  formatFieldName,
  formatValue,
  moduleLabel,
  type TimelineEvent,
} from '@/lib/timeline'
import { CategoryChip, SOURCE_ICON, TimelineMarker, eventIcon } from './timeline-style'

type Props = {
  event: TimelineEvent
  /** Selection is opt-in — only rendered while an export selection is active. */
  selectable: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
  onOpen: (event: TimelineEvent) => void
  /** Navigate to the module or entity this event is about. */
  onNavigate: (href: string) => void
}

/**
 * One event on the rail.
 *
 * The card shows the headline plus the two things that make history usable —
 * who did it and where they did it from — and, when the event carries a diff,
 * the first change inline so the common case ("what did it change to?") needs
 * no click at all.
 */
export function TimelineEventCard({
  event,
  selectable,
  selected,
  onToggleSelect,
  onOpen,
  onNavigate,
}: Props) {
  const diffs = diffValues(event.previousValue, event.newValue)
  const time = new Date(event.createdAt).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <li className="relative flex gap-3 pl-0">
      {/* Rail marker. The connecting line is drawn by the parent list so it
          runs continuously between cards rather than butting between them. */}
      <div className="relative z-10 flex flex-col items-center pt-4">
        <TimelineMarker category={event.category} severity={event.severity}>
          {eventIcon(event)}
        </TimelineMarker>
      </div>

      <div
        className="group mb-2 min-w-0 flex-1 rounded-xl border p-4 transition-colors"
        style={{
          background: selected ? 'color-mix(in srgb, var(--p-soft) 55%, var(--panel))' : 'var(--panel)',
          borderColor: selected ? 'var(--p-1)' : 'var(--line-strong)',
        }}
      >
        <div className="flex items-start gap-3">
          {selectable && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(event.id)}
              aria-label={`Select "${event.title}" for export`}
              className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--p-1)]"
            />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">{event.title}</p>
              <CategoryChip category={event.category} label={CATEGORY_LABELS[event.category]} />
            </div>

            {event.description && (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
                {event.description}
              </p>
            )}

            {/* Inline diff preview — the first changed field, which is the one
                the headline already hinted at. The rest live in the drawer. */}
            {diffs.length > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="font-medium" style={{ color: 'var(--text-3)' }}>
                  {formatFieldName(diffs[0].field)}
                </span>
                <span style={{ color: 'var(--text-3)' }}>
                  <s>{truncate(formatValue(diffs[0].previous))}</s>
                </span>
                <span style={{ color: 'var(--text-3)' }}>→</span>
                <span className="font-medium text-foreground">{truncate(formatValue(diffs[0].next))}</span>
                {diffs.length > 1 && (
                  <span style={{ color: 'var(--text-3)' }}>+{diffs.length - 1} more</span>
                )}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
              <span title={new Date(event.createdAt).toLocaleString()}>{time}</span>
              <span>{eventLabel(event.eventType)}</span>
              <span>by {formatActor(event.actor)}</span>
              <span className="inline-flex items-center gap-1" title={`Change made via ${SOURCE_LABELS[event.source]}`}>
                {SOURCE_ICON[event.source]}
                {SOURCE_LABELS[event.source]}
              </span>
              {event.module && <span>{moduleLabel(event.module)}</span>}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {event.link && (
              <button
                type="button"
                onClick={() => onNavigate(event.link!)}
                title="Open the related page"
                aria-label="Open the related page"
                className="rounded-md p-1.5 transition"
                style={{ color: 'var(--text-3)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
              >
                <ArrowUpRight size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpen(event)}
              title="View details"
              aria-label="View event details"
              className="rounded-md p-1.5 transition"
              style={{ color: 'var(--text-3)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
            >
              <Maximize2 size={13} />
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}

/** Keep an inline diff to one line — the drawer shows the untruncated value. */
function truncate(value: string, max = 42): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
