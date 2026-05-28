import type { RoadmapItem } from '@/lib/roadmap-types'
import { ROADMAP_STATUS_COLOR } from '@/lib/roadmap-types'
import { StatusBadge } from './StatusBadge'

/**
 * Single roadmap card. Same shape across all three columns (Shipped / In
 * progress / Planned) so the visual rhythm is consistent — only the status
 * accent and badge change. Hover state lifts the card and tints the border
 * with the status accent.
 */
export function RoadmapTaskCard({ item }: { item: RoadmapItem }) {
  const accent = ROADMAP_STATUS_COLOR[item.status]
  return (
    <article
      className="group relative flex h-full flex-col gap-3 rounded-2xl border p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.35)]"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      data-status={item.status}
    >
      {/* Subtle accent bar on the left edge so each card visually inherits
          its column's status colour without needing a coloured background. */}
      <span
        className="pointer-events-none absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full opacity-60 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: accent }}
        aria-hidden
      />

      <div className="flex items-start justify-between gap-3">
        <StatusBadge status={item.status} size="sm" />
        {item.version && (
          <span
            className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold"
            style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
          >
            v{item.version}
          </span>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold leading-snug text-foreground">{item.title}</h3>
        {item.description && (
          <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {item.description}
          </p>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
        >
          {item.category}
        </span>
        {item.id && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-3)' }}>
            {item.id}
          </span>
        )}
      </div>
    </article>
  )
}
