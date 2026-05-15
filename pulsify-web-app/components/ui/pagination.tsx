'use client'

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

type Props = {
  page: number
  pageSize: number
  total: number
  pageSizeOptions?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  className?: string
}

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100]

export const PAGE_SIZE_OPTIONS = DEFAULT_PAGE_SIZES

export function Pagination({
  page,
  pageSize,
  total,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  onPageChange,
  onPageSizeChange,
  className,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const end = Math.min(safePage * pageSize, total)

  const canPrev = safePage > 1
  const canNext = safePage < totalPages

  return (
    <div
      className={`flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${className ?? ''}`}
      style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
    >
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          Showing <span className="font-mono text-foreground">{start.toLocaleString()}</span>
          –<span className="font-mono text-foreground">{end.toLocaleString()}</span>{' '}
          of <span className="font-mono text-foreground">{total.toLocaleString()}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <span>Per page</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded border px-1.5 py-0.5 text-xs focus:outline-none"
            style={{
              background: 'var(--panel)',
              borderColor: 'var(--line-strong)',
              color: 'var(--text)',
            }}
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <PagerButton onClick={() => onPageChange(1)} disabled={!canPrev} title="First page">
          <ChevronsLeft size={12} />
        </PagerButton>
        <PagerButton onClick={() => onPageChange(safePage - 1)} disabled={!canPrev} title="Previous">
          <ChevronLeft size={12} />
        </PagerButton>
        <span className="px-2 text-xs text-muted-foreground">
          Page <span className="font-mono text-foreground">{safePage}</span> of{' '}
          <span className="font-mono text-foreground">{totalPages}</span>
        </span>
        <PagerButton onClick={() => onPageChange(safePage + 1)} disabled={!canNext} title="Next">
          <ChevronRight size={12} />
        </PagerButton>
        <PagerButton onClick={() => onPageChange(totalPages)} disabled={!canNext} title="Last page">
          <ChevronsRight size={12} />
        </PagerButton>
      </div>
    </div>
  )
}

function PagerButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded border transition disabled:opacity-30"
      style={{
        background: 'var(--panel)',
        borderColor: 'var(--line-strong)',
        color: 'var(--text-3)',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = 'var(--bg-2)'
          e.currentTarget.style.color = 'var(--text)'
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = 'var(--panel)'
          e.currentTarget.style.color = 'var(--text-3)'
        }
      }}
    >
      {children}
    </button>
  )
}
