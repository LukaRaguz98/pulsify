import { Skeleton } from './skeleton'

/**
 * Structured loading placeholder for data tables: a header row plus `rows` body
 * rows of shimmer cells inside the same bordered card the real table uses, so
 * there's no layout jump when data arrives. Prefer this over a bare centered
 * spinner for any table/list that fetches client-side.
 */
export function TableSkeleton({
  rows = 6,
  columns = 4,
  className,
}: {
  rows?: number
  columns?: number
  className?: string
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border ${className ?? ''}`}
      style={{ borderColor: 'var(--line-strong)' }}
      aria-hidden
    >
      {/* Header */}
      <div
        className="flex items-center gap-4 border-b px-4 py-3"
        style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
      >
        {Array.from({ length: columns }).map((_, c) => (
          <Skeleton key={c} className={`h-3 ${c === 0 ? 'w-28' : 'flex-1'}`} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex items-center gap-4 border-b px-4 py-3.5 last:border-b-0"
          style={{ borderColor: 'var(--line-strong)' }}
        >
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={`h-4 ${c === 0 ? 'w-40' : 'flex-1'}`} />
          ))}
        </div>
      ))}
    </div>
  )
}
