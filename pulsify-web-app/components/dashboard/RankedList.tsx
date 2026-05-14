import type { ReactNode } from 'react'

export type RankedItem = {
  id: string
  label: string
  value: number
  icon?: ReactNode
}

type Props = {
  items: RankedItem[]
  valueFormatter?: (v: number) => string
  barColor?: string
  emptyText?: string
}

export function RankedList({
  items,
  valueFormatter,
  barColor = 'var(--p-1)',
  emptyText = 'No data yet.',
}: Props) {
  if (items.length === 0) {
    return <p className="py-2 text-sm text-subtle">{emptyText}</p>
  }

  const max = Math.max(...items.map((i) => i.value), 1)

  return (
    <ul className="space-y-3">
      {items.map((item, idx) => (
        <li key={item.id}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold"
                style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}
              >
                {idx + 1}
              </span>
              {item.icon && <span className="shrink-0 text-subtle">{item.icon}</span>}
              <span className="truncate text-muted-foreground">{item.label}</span>
            </div>
            <span className="shrink-0 font-mono text-xs text-foreground">
              {valueFormatter ? valueFormatter(item.value) : item.value.toLocaleString()}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full" style={{ background: 'var(--bg-2)' }}>
            <div
              className="h-1.5 rounded-full transition-all"
              style={{ width: `${(item.value / max) * 100}%`, background: barColor }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
