import { STATUS_META, PRIORITY_META, type TicketStatus, type TicketPriority } from '@/lib/tickets'
import { APPLICATION_STATUS_META, type ApplicationStatus } from '@/lib/applications'
import { TicketIcon } from './icons'

/** Coloured pill for a ticket's status. */
export function StatusBadge({ status }: { status: TicketStatus }) {
  const meta = STATUS_META[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{
        color: meta.color,
        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${meta.color} 30%, transparent)`,
      }}
    >
      <TicketIcon name={meta.icon} size={11} />
      {meta.label}
    </span>
  )
}

/** Coloured pill for an application's review status. */
export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const meta = APPLICATION_STATUS_META[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{
        color: meta.color,
        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${meta.color} 30%, transparent)`,
      }}
    >
      <TicketIcon name={meta.icon} size={11} />
      {meta.label}
    </span>
  )
}

/** Coloured pill for a ticket's priority. */
export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const meta = PRIORITY_META[priority]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
      style={{
        color: meta.color,
        background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
      }}
    >
      <TicketIcon name={meta.icon} size={11} />
      {meta.label}
    </span>
  )
}
