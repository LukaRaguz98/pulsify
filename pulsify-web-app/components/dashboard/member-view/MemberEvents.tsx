import Image from 'next/image'
import { CalendarDays, Clock, MapPin, Users } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { formatEventStatus, formatEntityType, type DiscordScheduledEvent } from '@/lib/discord'

// Read-only event list for the member experience — what's coming up, when and
// where, with no management affordances (create/edit/cancel are admin-only).

const STATUS_COLOR: Record<number, string> = {
  1: 'var(--cyan)', // scheduled
  2: 'var(--green)', // active
  3: 'var(--text-3)', // completed
  4: 'var(--red)', // cancelled
}

function eventCoverUrl(eventId: string, image: string | null): string | null {
  if (!image) return null
  return `https://cdn.discordapp.com/guild-events/${eventId}/${image}.webp?size=512`
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function MemberEvents({ events }: { events: DiscordScheduledEvent[] }) {
  // Upcoming/live first, then by start time.
  const sorted = [...events].sort((a, b) => {
    const live = (e: DiscordScheduledEvent) => (e.status === 2 ? 0 : e.status === 1 ? 1 : 2)
    return live(a) - live(b) || a.scheduled_start_time.localeCompare(b.scheduled_start_time)
  })

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays size={36} />}
        title="No events scheduled"
        description="When the server schedules an event it will show up here with its time and location."
      />
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sorted.map((e) => {
        const cover = eventCoverUrl(e.id, e.image)
        return (
          <div
            key={e.id}
            className="overflow-hidden rounded-xl border"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            {cover && (
              <Image
                src={cover}
                alt={e.name}
                width={512}
                height={205}
                unoptimized
                className="h-32 w-full object-cover"
              />
            )}
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 truncate font-semibold text-foreground">{e.name}</p>
                <span
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                  style={{
                    background: `color-mix(in srgb, ${STATUS_COLOR[e.status]} 14%, transparent)`,
                    color: STATUS_COLOR[e.status],
                  }}
                >
                  {formatEventStatus(e.status)}
                </span>
              </div>
              {e.description && (
                <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{e.description}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
                <span className="inline-flex items-center gap-1">
                  <Clock size={12} />
                  {formatWhen(e.scheduled_start_time)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin size={12} />
                  {e.entity_metadata?.location ?? formatEntityType(e.entity_type)}
                </span>
                {typeof e.user_count === 'number' && (
                  <span className="inline-flex items-center gap-1">
                    <Users size={12} />
                    {e.user_count.toLocaleString()} interested
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
