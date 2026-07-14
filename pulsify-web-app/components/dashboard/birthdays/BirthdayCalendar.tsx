'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  partsInTimeZone,
  daysInMonth,
  MONTHS,
  type MemberBirthday,
} from '@/lib/birthdays'

// Month calendar of who's celebrating when. Shared by the admin Birthdays view
// and the read-only member view — it shows nothing privileged (the year is only
// rendered where the member chose to reveal it), so both surfaces use the same
// component rather than keeping two copies in sync.
export function BirthdayCalendar({
  birthdays,
  guildTz,
}: {
  birthdays: MemberBirthday[]
  guildTz: string
}) {
  const nowParts = partsInTimeZone(new Date(), guildTz)
  const [month, setMonth] = useState(nowParts.month) // 1-12

  const byDay = useMemo(() => {
    const m = new Map<number, MemberBirthday[]>()
    for (const b of birthdays) {
      if (b.birth_month !== month) continue
      const arr = m.get(b.birth_day) ?? []
      arr.push(b)
      m.set(b.birth_day, arr)
    }
    return m
  }, [birthdays, month])

  const days = daysInMonth(month)
  // Weekday of the 1st using a fixed reference year (layout only, not real dates).
  const firstWeekday = new Date(Date.UTC(2025, month - 1, 1)).getUTCDay()
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ]
  const monthList = birthdays
    .filter((b) => b.birth_month === month)
    .sort((a, b) => a.birth_day - b.birth_day)

  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => setMonth((m) => (m === 1 ? 12 : m - 1))}
          className="rounded-md p-1 text-subtle hover:text-foreground"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-foreground">{MONTHS[month - 1].name}</span>
        <button
          onClick={() => setMonth((m) => (m === 12 ? 1 : m + 1))}
          className="rounded-md p-1 text-subtle hover:text-foreground"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-subtle">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="py-1">{d}</span>
        ))}
        {cells.map((day, i) => {
          const has = day != null && byDay.has(day)
          const isToday = day === nowParts.day && month === nowParts.month
          return (
            <div
              key={i}
              className="flex aspect-square items-center justify-center rounded-md text-[11px]"
              title={has ? byDay.get(day!)!.map((b) => b.user_name ?? 'Member').join(', ') : undefined}
              style={{
                background: has ? 'rgba(244,114,182,0.15)' : 'transparent',
                color: day == null ? 'transparent' : has ? '#f472b6' : 'var(--text-2)',
                fontWeight: has ? 600 : 400,
                outline: isToday ? '1px solid var(--p-1)' : 'none',
              }}
            >
              {day ?? ''}
            </div>
          )
        })}
      </div>
      {monthList.length > 0 && (
        <div className="mt-3 space-y-1 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
          {monthList.map((b) => (
            <div key={b.user_id} className="flex items-center justify-between text-xs">
              <span className="truncate text-foreground">{b.user_name ?? 'Unknown member'}</span>
              <span className="text-subtle">{MONTHS[month - 1].short} {b.birth_day}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
