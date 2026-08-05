'use client'

import type { CSSProperties, ReactNode } from 'react'
import { Pagination } from '@/components/ui/pagination'
import { SortableHeader, nextSort, type SortDirection } from '@/components/ui/sortable-header'

/**
 * The dashboard's ranked table.
 *
 * Every table that ranks something — the leaderboards, the game list, the
 * closest pairs — is the same object: a bordered container, a panel header row
 * of click-to-sort columns, rows that stack into cards on a phone, and a pager
 * inside the border. This module owns that shape so the tables can't drift
 * apart again, and so "#" means the same thing everywhere: the row's place in
 * the ranking the server sent, which never changes when you sort by a column.
 *
 * Cells stay with the caller — only the chrome and the ordering are shared.
 * Give every cell a `data-label` (empty string for identity/action cells): the
 * `table-stack` rules read it to label the fields once the table becomes a
 * stack of cards.
 */

// ── Ordering ────────────────────────────────────────────────────────────────

export type SortState = { key: string; dir: SortDirection }

/** The default: the ranking the server sent, best first. */
export const RANK_SORT: SortState = { key: 'rank', dir: 'asc' }

/** Columns where the useful first click is A→Z / smallest-first. */
const ASCENDING_FIRST = new Set(['rank', 'name'])

export function nextRankedSort(current: SortState, key: string): SortState {
  return nextSort(current, key, ASCENDING_FIRST.has(key) ? 'asc' : 'desc')
}

/** A row with the place it holds, fixed before any sorting. */
export type Ranked<T> = { rank: number; row: T }

/**
 * Number the rows (the incoming order IS the ranking), then order them for the
 * current sort. `rank` sorts by that number; any other key reads a value out of
 * the row — strings compare by locale, everything else numerically.
 *
 * The rank travels with the row rather than being derived from its position, so
 * sorting by another column re-orders the table without renumbering anyone.
 */
export function rankAndSort<T>(
  rows: T[],
  sort: SortState,
  values: Record<string, (row: T) => number | string>,
): Ranked<T>[] {
  const ranked = rows.map((row, i) => ({ rank: i + 1, row }))
  const mul = sort.dir === 'asc' ? 1 : -1
  if (sort.key === 'rank' || !values[sort.key]) {
    return sort.dir === 'asc' ? ranked : ranked.reverse()
  }
  const read = values[sort.key]
  return ranked.sort((a, b) => {
    const av = read(a.row)
    const bv = read(b.row)
    const cmp =
      typeof av === 'string' || typeof bv === 'string'
        ? String(av).localeCompare(String(bv))
        : av - bv
    // Ties keep the original ranking, so equal values never shuffle randomly.
    return (cmp || a.rank - b.rank) * mul
  })
}

// ── Chrome ──────────────────────────────────────────────────────────────────

/** Fixed width for the leading rank ("#") column, so the identity column always
 *  starts at the same x-position no matter which table you are looking at. */
export const RANK_COL_WIDTH = 72
export const RANK_CELL_STYLE: CSSProperties = { width: RANK_COL_WIDTH }

export type SortProps = { sort: SortState; onSort: (key: string) => void }

/** The "#" header — sortable in every table, and the default order. */
export function RankHeader({ sort, onSort }: SortProps) {
  return (
    <th className="text-left" style={{ width: RANK_COL_WIDTH }}>
      <SortableHeader label="#" columnKey="rank" activeKey={sort.key} direction={sort.dir} onSort={onSort} />
    </th>
  )
}

export function SortHeader({
  label,
  columnKey,
  sort,
  onSort,
}: SortProps & { label: string; columnKey: string }) {
  return (
    <th className="text-left">
      <SortableHeader
        label={label}
        columnKey={columnKey}
        activeKey={sort.key}
        direction={sort.dir}
        onSort={onSort}
      />
    </th>
  )
}

export type Pager = {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

/**
 * Bordered container + table + (optional) pager. `minWidth` is inline rather
 * than a class because the stacked-card rules override it with `!important` on
 * phones — the table scrolls horizontally on desktop and stacks on mobile.
 */
export function DataTable({
  minWidth = 760,
  pager,
  children,
}: {
  minWidth?: number
  pager?: Pager
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--line-strong)' }}>
      <table className="w-full text-sm table-stack" style={{ minWidth }}>
        {children}
      </table>
      {pager && <Pagination {...pager} />}
    </div>
  )
}

/** The header row — wrap `RankHeader` / `SortHeader` cells in this. */
export function DataTableHead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        {children}
      </tr>
    </thead>
  )
}

const ROW_BACKGROUND = 'color-mix(in srgb, var(--panel) 50%, transparent)'

/** A body row. `interactive` adds the pointer + hover treatment; leave it off
 *  for rows with nothing to open (a departed member, an anonymised player). */
export function DataRow({
  interactive = false,
  onClick,
  title,
  children,
}: {
  interactive?: boolean
  onClick?: () => void
  title?: string
  children: ReactNode
}) {
  const live = interactive && typeof onClick === 'function'
  return (
    <tr
      onClick={live ? onClick : undefined}
      title={title}
      className={`border-b transition-colors${live ? ' cursor-pointer' : ''}`}
      style={{ borderColor: 'var(--line-strong)', background: ROW_BACKGROUND }}
      onMouseEnter={live ? (e) => { e.currentTarget.style.background = 'var(--bg-2)' } : undefined}
      onMouseLeave={live ? (e) => { e.currentTarget.style.background = ROW_BACKGROUND } : undefined}
    >
      {children}
    </tr>
  )
}
