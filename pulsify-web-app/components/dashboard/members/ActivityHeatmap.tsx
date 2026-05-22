'use client'

import { useMemo } from 'react'
import type { ProfileDailyPoint } from '@/lib/member-profile'

type Props = {
  daily: ProfileDailyPoint[]
  /** Number of days to show, ending today. Rounded up to whole weeks. */
  days?: number
}

type Cell = { date: Date; key: string; messages: number; level: number; inRange: boolean }

const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function levelColor(level: number): string {
  if (level === 0) return 'var(--bg-2)'
  const pct = [0, 30, 50, 75, 100][level]
  return `color-mix(in srgb, var(--p-1) ${pct}%, var(--bg-2))`
}

/**
 * GitHub-style contribution heatmap of daily message activity. Columns are
 * weeks (Sunday-anchored), rows are weekdays. Empty/out-of-range days render as
 * faint background squares so the grid keeps its shape.
 */
export function ActivityHeatmap({ daily, days = 119 }: Props) {
  const { weeks, monthLabels, max } = useMemo(() => {
    const byDay = new Map(daily.map((d) => [d.day, d.messages]))
    const max = Math.max(1, ...daily.map((d) => d.messages))

    const end = new Date()
    end.setHours(0, 0, 0, 0)
    const start = new Date(end)
    start.setDate(start.getDate() - (days - 1))
    // Anchor to the Sunday on/before the start so columns align by weekday.
    start.setDate(start.getDate() - start.getDay())

    const cells: Cell[] = []
    const cursor = new Date(start)
    while (cursor <= end) {
      const key = dayKey(cursor)
      const messages = byDay.get(key) ?? 0
      const level =
        messages === 0
          ? 0
          : messages <= max * 0.25
            ? 1
            : messages <= max * 0.5
              ? 2
              : messages <= max * 0.75
                ? 3
                : 4
      cells.push({ date: new Date(cursor), key, messages, level, inRange: true })
      cursor.setDate(cursor.getDate() + 1)
    }

    // Chunk into weeks of 7 (columns).
    const weeks: Cell[][] = []
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

    // Month label appears above the first week whose first day starts a new month.
    const monthLabels = weeks.map((week, i) => {
      const first = week[0]?.date
      if (!first) return ''
      const prevFirst = weeks[i - 1]?.[0]?.date
      if (i === 0 || (prevFirst && prevFirst.getMonth() !== first.getMonth())) {
        return MONTHS[first.getMonth()]
      }
      return ''
    })

    return { weeks, monthLabels, max }
  }, [daily, days])

  return (
    // min-h matches the 240px chart beside it so the grid centers vertically.
    <div className="flex min-h-[240px] items-center">
      <div className="w-full overflow-x-auto">
        <div className="mx-auto flex w-fit flex-col gap-1.5">
          {/* Month labels */}
          <div className="flex gap-1.5 pl-9">
            {monthLabels.map((label, i) => (
              <div key={i} className="w-[15px] text-[10px] text-subtle" style={{ minWidth: 15 }}>
                {label}
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            {/* Weekday labels */}
            <div className="flex flex-col gap-1.5 pr-1.5">
              {WEEKDAY_LABELS.map((label, i) => (
                <div key={i} className="h-[15px] text-[10px] leading-[15px] text-subtle" style={{ width: 24 }}>
                  {label}
                </div>
              ))}
            </div>
            {/* Week columns */}
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-1.5">
                {week.map((cell) => (
                  <div
                    key={cell.key}
                    className="h-[15px] w-[15px] rounded-sm"
                    style={{ background: levelColor(cell.level) }}
                    title={`${cell.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} — ${cell.messages} message${cell.messages === 1 ? '' : 's'}`}
                  />
                ))}
              </div>
            ))}
          </div>
          {/* Legend */}
          <div className="mt-1 flex items-center justify-end gap-1 pr-0.5 text-[10px] text-subtle">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className="h-[12px] w-[12px] rounded-sm" style={{ background: levelColor(l) }} />
            ))}
            <span>More (peak {max.toLocaleString()})</span>
          </div>
        </div>
      </div>
    </div>
  )
}
