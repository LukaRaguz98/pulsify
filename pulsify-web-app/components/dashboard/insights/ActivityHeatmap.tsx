import { formatHourLabel } from '@/lib/analytics'

// Mon-first, matching the heatmap RPC's `dow` (0 = Monday).
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const LEGEND_STOPS = [0, 0.25, 0.5, 0.75, 1]

// A filled cell ramps from a faint tint at low intensity to the full accent at
// the busiest cell, so the hottest slots read instantly. Empty cells stay the
// neutral track colour.
function cellColor(count: number, max: number, accent: string): string {
  if (count <= 0 || max <= 0) return 'var(--bg-2)'
  const pct = Math.round(15 + 85 * (count / max))
  return `color-mix(in srgb, ${accent} ${pct}%, var(--bg-2))`
}

type Props = {
  /** 7×24 message counts, indexed [dow][hour] (dow 0 = Monday). */
  cells: number[][]
  max: number
  accent?: string
}

/**
 * GitHub-style day×hour activity grid. Horizontally scrollable on narrow
 * screens so the 24-hour axis never squashes the cells.
 */
export function ActivityHeatmap({ cells, max, accent = 'var(--p-1)' }: Props) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[520px]">
        {/* Hour axis — label every 6 hours to stay legible. */}
        <div className="mb-1 flex gap-1 pl-9">
          {HOURS.map((h) => (
            <div key={h} className="flex-1 text-center text-[9px] leading-none text-subtle">
              {h % 6 === 0 ? formatHourLabel(h) : ''}
            </div>
          ))}
        </div>

        {cells.map((row, d) => (
          <div key={d} className="mb-1 flex items-center gap-1">
            <span className="w-8 shrink-0 text-[10px] text-subtle">{WEEKDAYS[d]}</span>
            <div className="flex flex-1 gap-1">
              {row.map((count, h) => (
                <div
                  key={h}
                  className="aspect-square flex-1 rounded-[3px]"
                  style={{ background: cellColor(count, max, accent) }}
                  title={`${WEEKDAYS[d]} ${formatHourLabel(h)} — ${count.toLocaleString()} message${count === 1 ? '' : 's'}`}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Legend */}
        <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-subtle">
          <span>Less</span>
          {LEGEND_STOPS.map((t) => (
            <span
              key={t}
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ background: t === 0 ? 'var(--bg-2)' : cellColor(t, 1, accent) }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  )
}
