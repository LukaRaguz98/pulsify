'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { CalendarDays, MapPin, Mic2, Volume2, Users, RefreshCw, Loader2 } from 'lucide-react'
import { formatEventStatus, formatEntityType } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { OpenInDiscordButton } from '@/components/ui/open-in-discord'

type DiscordScheduledEvent = {
  id: string
  guild_id: string
  name: string
  description: string | null
  scheduled_start_time: string
  scheduled_end_time: string | null
  status: 1 | 2 | 3 | 4
  entity_type: 1 | 2 | 3
  entity_metadata: { location?: string } | null
  image: string | null
  user_count?: number
}

const statusStyles: Record<number, { bg: string; color: string }> = {
  1: { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' },
  2: { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  3: { bg: 'var(--bg-2)', color: 'var(--text-3)' },
  4: { bg: 'rgba(239,68,68,0.12)', color: '#ef4444' },
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

const POLL_INTERVAL = 15_000

type Props = { guildId: string }

export function EventsContent({ guildId }: Props) {
  const [events, setEvents] = useState<DiscordScheduledEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [secondsAgo, setSecondsAgo] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const res = await fetch(`/api/discord/guild/${guildId}/events`, { cache: 'no-store' })
      if (res.ok) {
        setEvents(await res.json())
        setLastUpdated(new Date())
        setSecondsAgo(0)
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [guildId])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    timerRef.current = setInterval(() => fetchData(true), POLL_INTERVAL)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [fetchData])

  useEffect(() => {
    const id = setInterval(() => {
      if (lastUpdated) setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  const upcoming = events.filter((e) => e.status === 1 || e.status === 2)
  const past = events.filter((e) => e.status === 3 || e.status === 4)
  const updatedLabel = lastUpdated ? (secondsAgo < 5 ? 'Just now' : `${secondsAgo}s ago`) : null

  if (loading) {
    return (
      <div className="page-content">
        <PageHeader title="Events" description="Manage Discord scheduled events for this server." />
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Events"
        description="Manage Discord scheduled events for this server."
        action={
          <div className="flex items-center gap-3">
            {updatedLabel && (
              <span className="text-xs text-subtle">Updated {updatedLabel}</span>
            )}
            <button
              onClick={() => fetchData()}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
            <OpenInDiscordButton
              webUrl={`https://discord.com/channels/${guildId}`}
              label="Create on Discord"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{
                background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
                boxShadow: '0 4px 14px -4px var(--p-glow)',
              }}
            />
          </div>
        }
      />

      {events.length === 0 && (
        <EmptyState
          icon={<CalendarDays size={40} />}
          title="No events scheduled"
          description="Create a scheduled event on Discord and it will appear here."
        />
      )}

      {upcoming.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-subtle">
            Upcoming & Active ({upcoming.length})
          </h2>
          <div className="space-y-3">
            {upcoming.map((event) => {
              const style = statusStyles[event.status] ?? statusStyles[3]
              return (
                <div
                  key={event.id}
                  className="rounded-xl border p-5"
                  style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: style.bg, color: style.color }}
                        >
                          {formatEventStatus(event.status)}
                        </span>
                        <span className="text-xs text-subtle flex items-center gap-1">
                          {event.entity_type === 1 && <Mic2 size={11} />}
                          {event.entity_type === 2 && <Volume2 size={11} />}
                          {event.entity_type === 3 && <MapPin size={11} />}
                          {formatEntityType(event.entity_type)}
                        </span>
                      </div>
                      <h3 className="font-semibold text-foreground">{event.name}</h3>
                      {event.description && (
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{event.description}</p>
                      )}
                      {event.entity_metadata?.location && (
                        <p className="mt-1 text-xs text-subtle flex items-center gap-1">
                          <MapPin size={11} />
                          {event.entity_metadata.location}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-sm text-muted-foreground shrink-0">
                      <p>{formatDate(event.scheduled_start_time)}</p>
                      {event.scheduled_end_time && (
                        <p className="text-xs text-subtle mt-0.5">
                          Ends {formatDate(event.scheduled_end_time)}
                        </p>
                      )}
                      {event.user_count !== undefined && (
                        <p className="mt-1 text-xs text-subtle flex items-center justify-end gap-1">
                          <Users size={11} />
                          {event.user_count} interested
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-subtle">
            Past Events ({past.length})
          </h2>
          <div className="space-y-3">
            {past.map((event) => {
              const style = statusStyles[event.status] ?? statusStyles[3]
              return (
                <div
                  key={event.id}
                  className="rounded-xl border p-5 opacity-60"
                  style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: style.bg, color: style.color }}
                      >
                        {formatEventStatus(event.status)}
                      </span>
                      <h3 className="mt-1.5 font-semibold text-foreground">{event.name}</h3>
                    </div>
                    <p className="text-sm text-subtle shrink-0">
                      {formatDate(event.scheduled_start_time)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
