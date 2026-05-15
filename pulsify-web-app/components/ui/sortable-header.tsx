'use client'

import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

export type SortDirection = 'asc' | 'desc'

type Props = {
  label: string
  columnKey: string
  activeKey: string
  direction: SortDirection
  onSort: (key: string) => void
  align?: 'left' | 'right' | 'center'
  className?: string
}

export function SortableHeader({
  label,
  columnKey,
  activeKey,
  direction,
  onSort,
  align = 'left',
  className,
}: Props) {
  const active = activeKey === columnKey
  const justify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'

  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      className={`group flex w-full items-center gap-1 px-4 py-3 text-xs font-semibold uppercase tracking-wider transition ${justify} ${className ?? ''}`}
      style={{ color: active ? 'var(--text)' : 'var(--text-3)' }}
    >
      {label}
      {active ? (
        direction === 'asc' ? (
          <ChevronUp size={11} style={{ color: 'var(--p-1)' }} />
        ) : (
          <ChevronDown size={11} style={{ color: 'var(--p-1)' }} />
        )
      ) : (
        <ChevronsUpDown
          size={11}
          className="opacity-0 transition group-hover:opacity-60"
          style={{ color: 'var(--text-3)' }}
        />
      )}
    </button>
  )
}

/**
 * Helper for the click handler — toggles direction if the same column is
 * clicked, otherwise activates the new column with the given default direction.
 */
export function nextSort(
  current: { key: string; dir: SortDirection },
  clickedKey: string,
  defaultDir: SortDirection = 'desc',
): { key: string; dir: SortDirection } {
  if (current.key === clickedKey) {
    return { key: clickedKey, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  }
  return { key: clickedKey, dir: defaultDir }
}
