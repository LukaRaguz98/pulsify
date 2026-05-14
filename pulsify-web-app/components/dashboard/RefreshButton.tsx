'use client'

import { RefreshCw } from 'lucide-react'

type Props = {
  onClick: () => void
  refreshing: boolean
}

export function RefreshButton({ onClick, refreshing }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={refreshing}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
      style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
    >
      <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
      Refresh
    </button>
  )
}
