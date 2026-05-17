'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Image from 'next/image'
import {
  CalendarDays, MapPin, Mic2, Volume2, Users, RefreshCw, Loader2, Plus,
  Search, LayoutGrid, Calendar as CalendarIcon, AlertCircle, CheckCircle2,
  TrendingUp, Activity, Globe, ChevronRight, Sparkles,
} from 'lucide-react'
import { formatEventStatus, formatEntityType, type DiscordScheduledEvent, type DiscordChannel } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { CategorySection } from '@/components/ui/category-section'
import { EventEditor } from './events/EventEditor'
import { EventCalendar } from './events/EventCalendar'
import { ParticipantsModal } from './events/ParticipantsModal'

const POLL_INTERVAL = 15_000
const TRANSIENT_ERROR_HINT = "Couldn't verify your Discord access"

type ViewMode = 'list' | 'calendar'
type TypeFilter = 'all' | 1 | 2 | 3
type Toast = { kind: 'ok' | 'err'; text: string }

type Props = { guildId: string }

const STATUS_STYLES: Record<number, { bg: string; color: string; label: string }> = {
  // Scheduled === Upcoming — share the accent purple of the Upcoming stat
  // card + group header so the visual language stays consistent.
  1: { bg: 'var(--p-soft)', color: 'var(--p-1)', label: 'Scheduled' },
  2: { bg: 'rgba(16,185,129,0.12)', color: '#10b981', label: 'Live' },
  3: { bg: 'var(--bg-2)', color: 'var(--text-3)', label: 'Completed' },
  4: { bg: 'rgba(239,68,68,0.12)', color: '#ef4444', label: 'Canceled' },
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

export function EventsContent({ guildId }: Props) {
  const [events, setEvents] = useState<DiscordScheduledEvent[]>([])
  const [channels, setChannels] = useState<DiscordChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [view, setView] = useState<ViewMode>('list')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  const [editing, setEditing] = useState<DiscordScheduledEvent | null>(null)
  const [creating, setCreating] = useState(false)
  const [participantsOf, setParticipantsOf] = useState<DiscordScheduledEvent | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchAll = useCallback(async (attempt = 0, silent = false): Promise<void> => {
    if (!silent) setRefreshing(true)
    const [eventsRes, channelsRes] = await Promise.all([
      fetch(`/api/discord/guild/${guildId}/events`, { cache: 'no-store' }),
      fetch(`/api/discord/guild/${guildId}/channels`, { cache: 'no-store' }),
    ])

    if (!eventsRes.ok) {
      const data = (await eventsRes.json().catch(() => ({}))) as { error?: string }
      // Same retry pattern as Roles for transient Discord blips.
      if (data.error?.includes(TRANSIENT_ERROR_HINT) && attempt < 15) {
        const delay = Math.min(2000, 600 + attempt * 200)
        retryRef.current = setTimeout(() => fetchAll(attempt + 1, silent), delay)
        return
      }
      setError(data.error ?? 'Could not load events.')
      setLoading(false)
      setRefreshing(false)
      return
    }

    setEvents((await eventsRes.json()) as DiscordScheduledEvent[])
    if (channelsRes.ok) setChannels((await channelsRes.json()) as DiscordChannel[])
    setError(null)
    setLoading(false)
    setRefreshing(false)
  }, [guildId])

  useEffect(() => {
    fetchAll()
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current)
    }
  }, [fetchAll])

  // Silent polling so live status changes (Scheduled → Live → Completed) show
  // up without manual refresh. Skipped while the editor is open to avoid
  // overwriting in-flight edits the user can see.
  useEffect(() => {
    if (editing || creating) return
    pollRef.current = setInterval(() => fetchAll(0, true), POLL_INTERVAL)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchAll, editing, creating])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events.filter((e) => {
      if (typeFilter !== 'all' && e.entity_type !== typeFilter) return false
      if (!q) return true
      return (
        e.name.toLowerCase().includes(q)
        || (e.description ?? '').toLowerCase().includes(q)
        || (e.entity_metadata?.location ?? '').toLowerCase().includes(q)
      )
    })
  }, [events, search, typeFilter])

  // Status buckets.
  const live = filtered.filter((e) => e.status === 2)
  const upcoming = filtered
    .filter((e) => e.status === 1)
    .sort((a, b) =>
      new Date(a.scheduled_start_time).getTime() - new Date(b.scheduled_start_time).getTime(),
    )
  const past = filtered
    .filter((e) => e.status === 3 || e.status === 4)
    .sort((a, b) =>
      new Date(b.scheduled_start_time).getTime() - new Date(a.scheduled_start_time).getTime(),
    )

  // Analytics (static for v1 — reflects current state, not historical trends).
  const totalParticipants = events.reduce((sum, e) => sum + (e.user_count ?? 0), 0)
  const topInterest = [...events]
    .sort((a, b) => (b.user_count ?? 0) - (a.user_count ?? 0))
    .slice(0, 3)

  function openCreate() {
    setEditing(null)
    setCreating(true)
  }

  function openEdit(e: DiscordScheduledEvent) {
    setCreating(false)
    setEditing(e)
  }

  function closeEditor() {
    setEditing(null)
    setCreating(false)
  }

  function handleSaved(saved: DiscordScheduledEvent, isNew: boolean) {
    setEvents((prev) =>
      isNew ? [...prev, saved] : prev.map((e) => (e.id === saved.id ? saved : e)),
    )
    setToast({ kind: 'ok', text: isNew ? 'Event created.' : 'Event updated.' })
    closeEditor()
  }

  function handleDeleted(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id))
    setToast({ kind: 'ok', text: 'Event deleted.' })
    closeEditor()
  }

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
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchAll()}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition"
              style={{ background: 'var(--p-1)', color: '#fff' }}
            >
              <Plus size={14} />
              Create event
            </button>
          </div>
        }
      />

      {error && (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
        >
          <AlertCircle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {toast && (
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: toast.kind === 'ok' ? 'rgba(74,222,128,0.35)' : 'rgba(239,68,68,0.35)',
            background: toast.kind === 'ok' ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)',
            color: toast.kind === 'ok' ? '#4ade80' : '#f87171',
          }}
        >
          {toast.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {toast.text}
        </div>
      )}

      <div className="space-y-8">
        <CategorySection
          icon={<TrendingUp size={14} />}
          title="At a glance"
          description="Snapshot of events in this server right now."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={<CalendarDays size={16} />} label="Total events" value={events.length} accent="#3b82f6" />
            <Stat icon={<Activity size={16} />} label="Live now" value={live.length} accent="#10b981" />
            <Stat icon={<CalendarIcon size={16} />} label="Upcoming" value={upcoming.length} accent="var(--p-1)" />
            <Stat icon={<Users size={16} />} label="Total interested" value={totalParticipants} accent="#f59e0b" />
          </div>
          {topInterest.length > 0 && topInterest[0].user_count !== undefined && topInterest[0].user_count > 0 && (
            <div className="mt-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
                <Sparkles size={11} />
                Most popular events
              </p>
              <ul className="space-y-1.5">
                {topInterest.filter((e) => (e.user_count ?? 0) > 0).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
                    <button
                      type="button"
                      onClick={() => openEdit(e)}
                      className="min-w-0 flex-1 truncate text-left text-foreground hover:underline"
                    >
                      {e.name}
                    </button>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-subtle">
                      <Users size={11} />
                      {e.user_count} interested
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CategorySection>

        <CategorySection
          icon={<CalendarDays size={14} />}
          title="Manage"
          description="Filter, search, and switch between list and calendar views."
        >
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="inline-flex rounded-lg border p-1"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
            >
              <ViewToggle active={view === 'list'} onClick={() => setView('list')} icon={<LayoutGrid size={13} />}>List</ViewToggle>
              <ViewToggle active={view === 'calendar'} onClick={() => setView('calendar')} icon={<CalendarIcon size={13} />}>Calendar</ViewToggle>
            </div>

            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search events…"
                className="w-full rounded-lg border py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-1"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </div>

            <div className="ml-auto inline-flex rounded-lg border p-1"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
              {(['all', 1, 2, 3] as const).map((f) => (
                <button
                  key={String(f)}
                  type="button"
                  onClick={() => setTypeFilter(f)}
                  className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition"
                  style={{
                    background: typeFilter === f ? 'var(--p-soft)' : 'transparent',
                    color: typeFilter === f ? 'var(--p-1)' : 'var(--text-3)',
                  }}
                >
                  {f === 'all' && 'All'}
                  {f === 1 && <><Mic2 size={11} /> Stage</>}
                  {f === 2 && <><Volume2 size={11} /> Voice</>}
                  {f === 3 && <><Globe size={11} /> External</>}
                </button>
              ))}
            </div>
          </div>

          {view === 'calendar' ? (
            <EventCalendar events={filtered} onEventClick={openEdit} />
          ) : (
            <ListView
              live={live}
              upcoming={upcoming}
              past={past}
              onEdit={openEdit}
              onShowParticipants={setParticipantsOf}
            />
          )}
        </CategorySection>
      </div>

      {(editing || creating) && (
        <EventEditor
          guildId={guildId}
          event={editing}
          isCreating={creating}
          channels={channels}
          onClose={closeEditor}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}

      {participantsOf && (
        <ParticipantsModal
          guildId={guildId}
          eventId={participantsOf.id}
          eventName={participantsOf.name}
          onClose={() => setParticipantsOf(null)}
        />
      )}
    </div>
  )
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border p-4"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-semibold leading-none text-foreground">{value.toLocaleString()}</p>
        <p className="mt-1 text-xs text-subtle">{label}</p>
      </div>
    </div>
  )
}

function ViewToggle({
  active, onClick, icon, children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition"
      style={{
        background: active ? 'var(--p-soft)' : 'transparent',
        color: active ? 'var(--p-1)' : 'var(--text-3)',
      }}
    >
      {icon}
      {children}
    </button>
  )
}

function ListView({
  live, upcoming, past, onEdit, onShowParticipants,
}: {
  live: DiscordScheduledEvent[]
  upcoming: DiscordScheduledEvent[]
  past: DiscordScheduledEvent[]
  onEdit: (e: DiscordScheduledEvent) => void
  onShowParticipants: (e: DiscordScheduledEvent) => void
}) {
  if (live.length === 0 && upcoming.length === 0 && past.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays size={36} />}
        title="No events match"
        description="Try adjusting the search or filters, or create a new event."
      />
    )
  }
  return (
    <div className="space-y-6">
      {live.length > 0 && (
        <EventGroup label={`Live now (${live.length})`} accent="#10b981">
          {live.map((e) => <EventCard key={e.id} event={e} onEdit={onEdit} onShowParticipants={onShowParticipants} />)}
        </EventGroup>
      )}
      {upcoming.length > 0 && (
        <EventGroup label={`Upcoming (${upcoming.length})`} accent="var(--p-1)">
          {upcoming.map((e) => <EventCard key={e.id} event={e} onEdit={onEdit} onShowParticipants={onShowParticipants} />)}
        </EventGroup>
      )}
      {past.length > 0 && (
        <EventGroup label={`Past & canceled (${past.length})`} accent="var(--text-3)">
          {past.map((e) => <EventCard key={e.id} event={e} onEdit={onEdit} onShowParticipants={onShowParticipants} muted />)}
        </EventGroup>
      )}
    </div>
  )
}

function EventGroup({ label, accent, children }: { label: string; accent: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: accent }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
        {label}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function EventCard({
  event, onEdit, onShowParticipants, muted,
}: {
  event: DiscordScheduledEvent
  onEdit: (e: DiscordScheduledEvent) => void
  onShowParticipants: (e: DiscordScheduledEvent) => void
  muted?: boolean
}) {
  const style = STATUS_STYLES[event.status] ?? STATUS_STYLES[3]
  const cover = event.image
    ? `https://cdn.discordapp.com/guild-events/${event.id}/${event.image}.png?size=512`
    : null
  return (
    <div
      className="overflow-hidden rounded-xl border transition-all hover:border-[var(--p-1)]"
      style={{
        background: 'var(--panel)',
        borderColor: 'var(--line-strong)',
        opacity: muted ? 0.7 : 1,
      }}
    >
      <div className="flex gap-4 p-5">
        {cover && (
          <div className="hidden h-24 w-40 shrink-0 overflow-hidden rounded-lg sm:block">
            <Image
              src={cover}
              alt={event.name}
              width={160}
              height={96}
              className="h-full w-full object-cover"
              unoptimized
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="mb-1.5 flex items-center gap-2 flex-wrap">
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: style.bg, color: style.color }}
            >
              {formatEventStatus(event.status)}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-subtle">
              {event.entity_type === 1 && <Mic2 size={11} />}
              {event.entity_type === 2 && <Volume2 size={11} />}
              {event.entity_type === 3 && <Globe size={11} />}
              {formatEntityType(event.entity_type)}
            </span>
            {event.entity_metadata?.location && (
              <span className="inline-flex items-center gap-1 text-xs text-subtle">
                <MapPin size={11} />
                <span className="truncate max-w-[200px]">{event.entity_metadata.location}</span>
              </span>
            )}
          </div>
          <h3 className="font-semibold text-foreground">{event.name}</h3>
          {event.description && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{event.description}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle">
            <span className="flex items-center gap-1">
              <CalendarDays size={11} />
              {formatDate(event.scheduled_start_time)}
            </span>
            {event.scheduled_end_time && (
              <span>→ {formatDate(event.scheduled_end_time)}</span>
            )}
            {event.user_count !== undefined && event.user_count > 0 && (
              <button
                type="button"
                onClick={() => onShowParticipants(event)}
                className="inline-flex items-center gap-1 transition hover:text-foreground"
              >
                <Users size={11} />
                {event.user_count} interested
              </button>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => onEdit(event)}
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:bg-[var(--bg-2)]"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            {event.status === 1 ? 'Edit' : 'View'}
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
