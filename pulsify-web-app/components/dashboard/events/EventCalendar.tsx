'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Mic2, Volume2, Globe } from 'lucide-react'
import type { DiscordScheduledEvent } from '@/lib/discord'

type Props = {
  events: DiscordScheduledEvent[]
  onEventClick: (event: DiscordScheduledEvent) => void
}

const STATUS_COLORS: Record<number, string> = {
  1: 'var(--p-1)',
  2: '#10b981',
  3: 'var(--text-3)',
  4: '#ef4444',
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

// Build a 6×7 grid of dates starting at the Monday on or before the 1st of the
// target month, so the calendar always lays out as full weeks.
function buildMonthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor)
  const dayOfWeek = (first.getDay() + 6) % 7  // 0=Mon, 6=Sun
  const start = new Date(first)
  start.setDate(first.getDate() - dayOfWeek)
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    cells.push(d)
  }
  return cells
}

export function EventCalendar({ events, onEventClick }: Props) {
  const today = new Date()
  const [anchor, setAnchor] = useState<Date>(startOfMonth(today))

  // Bucket events by yyyy-mm-dd of their LOCAL start time for fast cell lookup.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, DiscordScheduledEvent[]>()
    for (const e of events) {
      const d = new Date(e.scheduled_start_time)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const list = map.get(key)
      if (list) list.push(e)
      else map.set(key, [e])
    }
    for (const list of map.values()) {
      list.sort((a, b) =>
        new Date(a.scheduled_start_time).getTime() - new Date(b.scheduled_start_time).getTime(),
      )
    }
    return map
  }, [events])

  const cells = useMemo(() => buildMonthGrid(anchor), [anchor])
  const monthLabel = anchor.toLocaleString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <h3 className="text-sm font-semibold text-foreground">{monthLabel}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAnchor(addMonths(anchor, -1))}
            className="flex h-7 w-7 items-center justify-center rounded-lg border transition hover:bg-[var(--bg-2)]"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            aria-label="Previous month"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => setAnchor(startOfMonth(today))}
            className="rounded-lg border px-2.5 py-1 text-xs font-medium transition hover:bg-[var(--bg-2)]"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setAnchor(addMonths(anchor, 1))}
            className="flex h-7 w-7 items-center justify-center rounded-lg border transition hover:bg-[var(--bg-2)]"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            aria-label="Next month"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b text-center text-[10px] font-semibold uppercase tracking-wider text-subtle"
        style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7" style={{ background: 'var(--bg-2)' }}>
        {cells.map((cellDate, i) => {
          const inMonth = cellDate.getMonth() === anchor.getMonth()
          const isToday = isSameDay(cellDate, today)
          const key = `${cellDate.getFullYear()}-${cellDate.getMonth()}-${cellDate.getDate()}`
          const dayEvents = eventsByDay.get(key) ?? []

          return (
            <div
              key={i}
              className="min-h-[110px] border-r border-b p-1.5 transition-colors"
              style={{
                borderColor: 'var(--line-strong)',
                background: isToday ? 'color-mix(in srgb, var(--p-1) 6%, transparent)' : 'var(--panel)',
                opacity: inMonth ? 1 : 0.4,
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: isToday ? 'var(--p-1)' : 'var(--text-2)' }}
                >
                  {cellDate.getDate()}
                </span>
                {dayEvents.length > 3 && (
                  <span className="text-[9px] text-subtle">+{dayEvents.length - 3}</span>
                )}
              </div>
              <div className="mt-1 space-y-1">
                {dayEvents.slice(0, 3).map((e) => {
                  const color = STATUS_COLORS[e.status] ?? STATUS_COLORS[3]
                  const time = new Date(e.scheduled_start_time).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); onEventClick(e) }}
                      className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] font-medium transition hover:opacity-80"
                      style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
                      title={`${e.name} · ${time}`}
                    >
                      {e.entity_type === 1 && <Mic2 size={8} className="shrink-0" />}
                      {e.entity_type === 2 && <Volume2 size={8} className="shrink-0" />}
                      {e.entity_type === 3 && <Globe size={8} className="shrink-0" />}
                      <span className="truncate">{time}</span>
                      <span className="truncate opacity-80">{e.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
