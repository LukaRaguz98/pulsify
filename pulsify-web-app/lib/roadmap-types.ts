/**
 * Roadmap types + presentation maps. Kept in its own (no `server-only`) file
 * so client components can use the labels and status colours without pulling
 * the file-system loader into the client bundle.
 */

export type RoadmapStatus = 'shipped' | 'progress' | 'planned'

export type RoadmapItem = {
  status: RoadmapStatus
  /** Ticket id like "PULSIFY-12". Null if a task file omits it. */
  id: string | null
  title: string
  /** Target / shipped version (vX.Y.Z) when the source line names one. */
  version: string | null
  /** Single-line summary lifted from the task's Description block. */
  description: string
  /** Best-guess pillar tag for the card chip (Moderation, Analytics, …). */
  category: string
}

export const ROADMAP_STATUS_LABEL: Record<RoadmapStatus, string> = {
  shipped: 'Completed',
  progress: 'Active development',
  planned: 'Planned',
}

export const ROADMAP_COLUMN_LABEL: Record<RoadmapStatus, string> = {
  shipped: 'Shipped',
  progress: 'In progress',
  planned: 'Planned',
}

export const ROADMAP_STATUS_COLOR: Record<RoadmapStatus, string> = {
  shipped: '#10b981',
  progress: '#f59e0b',
  planned: 'var(--p-1)',
}
