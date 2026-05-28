import { CheckCircle2, Loader2, Circle } from 'lucide-react'
import {
  ROADMAP_STATUS_COLOR,
  ROADMAP_STATUS_LABEL,
  type RoadmapStatus,
} from '@/lib/roadmap-types'

const ICON: Record<RoadmapStatus, typeof CheckCircle2> = {
  shipped: CheckCircle2,
  progress: Loader2,
  planned: Circle,
}

/**
 * Shared status pill used by Release Notes and the Community roadmap. The
 * three statuses (Completed / Active development / Planned) keep their own
 * accent so a card's badge matches the column it lives in.
 */
export function StatusBadge({
  status,
  size = 'md',
}: {
  status: RoadmapStatus
  size?: 'sm' | 'md'
}) {
  const color = ROADMAP_STATUS_COLOR[status]
  const Icon = ICON[status]
  const padding = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
  const iconSize = size === 'sm' ? 10 : 12
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-wider ${padding}`}
      style={{
        background: `${color}1f`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
      <Icon size={iconSize} className={status === 'progress' ? 'animate-spin' : undefined} />
      {ROADMAP_STATUS_LABEL[status]}
    </span>
  )
}
