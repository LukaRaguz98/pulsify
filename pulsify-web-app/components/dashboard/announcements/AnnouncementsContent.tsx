'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Megaphone, Plus, CheckCircle2, AlertCircle, X, ListChecks, FileText, CalendarClock, Search } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import {
  computeAnnouncementStats,
  displayState,
  isEditable,
  STATUS_META,
  type Announcement,
  type AnnouncementDisplayState,
} from '@/lib/announcements'
import type { ActionResult } from '@/app/dashboard/[guildId]/announcements/actions'
import { AnnouncementCard } from './AnnouncementCard'
import { AnnouncementComposer } from './AnnouncementComposer'
import { AnnouncementDetail } from './AnnouncementDetail'

type Channel = { id: string; name: string }
type Feedback = { kind: 'success' | 'error'; msg: string }

type Props = {
  guildId: string
  guildName: string
  initialAnnouncements: Announcement[]
  channels: Channel[]
}

// Section order in the list view.
const SECTIONS: AnnouncementDisplayState[] = ['scheduled', 'draft', 'published', 'failed']

export function AnnouncementsContent({ guildId, guildName, initialAnnouncements, channels }: Props) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | AnnouncementDisplayState>('all')
  const [pending, startTransition] = useTransition()

  const channelNames = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels])

  // Quick-action deep link (?new=1) opens the composer once on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('new') === '1') {
      setCreating(true)
      params.delete('new')
      const qs = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    }
  }, [])

  const selected = useMemo(
    () => initialAnnouncements.find((a) => a.id === selectedId) ?? null,
    [initialAnnouncements, selectedId],
  )
  const stats = useMemo(() => computeAnnouncementStats(initialAnnouncements), [initialAnnouncements])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return initialAnnouncements.filter((a) => {
      if (statusFilter !== 'all' && displayState(a) !== statusFilter) return false
      if (!q) return true
      return a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q)
    })
  }, [initialAnnouncements, search, statusFilter])

  const grouped = useMemo(() => {
    const map = new Map<AnnouncementDisplayState, Announcement[]>()
    for (const a of filtered) {
      const state = displayState(a)
      const arr = map.get(state)
      if (arr) arr.push(a)
      else map.set(state, [a])
    }
    return map
  }, [filtered])

  const runAction = useCallback(
    async <T,>(fn: () => Promise<ActionResult<T>>, successMsg?: string): Promise<ActionResult<T>> => {
      const result = await fn()
      if (result.ok) {
        if (successMsg) setFeedback({ kind: 'success', msg: successMsg })
        startTransition(() => router.refresh())
      } else {
        setFeedback({ kind: 'error', msg: result.error })
      }
      return result
    },
    [router],
  )

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router])

  return (
    <div className="page-content">
      <PageHeader
        title="Announcements"
        description={
          <>
            Write and publish announcements to{' '}
            <span className="font-medium text-foreground">{guildName}</span> through Pulse
          </>
        }
        action={
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: stats.published > 0 ? '#22c55e' : 'var(--text-3)' }} />
              {stats.published} published
            </span>
            <RefreshButton onClick={refresh} refreshing={pending} />
          </div>
        }
      />

      {feedback && (
        <div
          className="mb-6 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
          style={
            feedback.kind === 'success'
              ? { borderColor: 'rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)', color: '#4ade80' }
              : { borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }
          }
        >
          {feedback.kind === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{feedback.msg}</span>
          <button onClick={() => setFeedback(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="space-y-8">
        {/* At a glance */}
        <CategorySection
          icon={<Megaphone size={14} />}
          title="At a glance"
          description="Announcements you've drafted and published in this server."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Megaphone size={16} />} label="Total" value={stats.total} color="#60a5fa" />
            <StatCard icon={<CheckCircle2 size={16} />} label="Published" value={stats.published} color="#22c55e" />
            <StatCard icon={<CalendarClock size={16} />} label="Scheduled" value={stats.scheduled} color="#3b82f6" />
            <StatCard icon={<FileText size={16} />} label="Drafts" value={stats.drafts} color="#a855f7" />
          </div>
        </CategorySection>

        {/* Manage */}
        <CategorySection
          icon={<ListChecks size={14} />}
          title="Manage"
          description="Browse previous announcements, draft a new one, and publish to a channel."
        >
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
            >
              <Plus size={15} />
              New announcement
            </button>
          </div>

          {initialAnnouncements.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border py-16 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                <Megaphone size={26} />
              </div>
              <p className="font-semibold text-foreground">No announcements yet</p>
              <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
                Write your first announcement — Pulse posts a polished embed to the channel you choose, and keeps a history here.
              </p>
              <button onClick={() => setCreating(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white" style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}>
                <Plus size={15} /> Create an announcement
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Search + status filter */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 sm:max-w-xs">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search announcements…"
                    className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
                    style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                  />
                </div>
                <div className="inline-flex flex-wrap rounded-lg border p-0.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
                  {(['all', ...SECTIONS] as const).map((f) => {
                    const active = statusFilter === f
                    const label = f === 'all' ? 'All' : STATUS_META[f].label
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setStatusFilter(f)}
                        className="rounded-md px-3 py-1 text-xs font-medium transition"
                        style={{ background: active ? 'var(--p-soft)' : 'transparent', color: active ? 'var(--p-1)' : 'var(--text-3)' }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border py-14 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
                    <Search size={22} />
                  </div>
                  <p className="font-semibold text-foreground">No matching announcements</p>
                  <p className="mt-1.5 text-sm" style={{ color: 'var(--text-3)' }}>Try a different search or filter.</p>
                </div>
              ) : (
                <div className="space-y-7">
                  {SECTIONS.map((state) => {
                    const items = grouped.get(state)
                    if (!items || items.length === 0) return null
                    const meta = STATUS_META[state]
                    return (
                      <section key={state}>
                        <div className="mb-3 flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
                          <h2 className="text-sm font-semibold text-foreground">{meta.label}</h2>
                          <span className="text-xs" style={{ color: 'var(--text-3)' }}>{items.length}</span>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {items.map((a) => (
                            <AnnouncementCard
                              key={a.id}
                              announcement={a}
                              channelName={channelNames.get(a.channel_id)}
                              onSelect={() => setSelectedId(a.id)}
                            />
                          ))}
                        </div>
                      </section>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </CategorySection>
      </div>

      {selected && (
        <AnnouncementDetail
          guildId={guildId}
          announcement={selected}
          channelName={channelNames.get(selected.channel_id)}
          runAction={runAction}
          onClose={() => setSelectedId(null)}
          onEdit={() => {
            if (isEditable(selected)) {
              setEditing(selected)
              setSelectedId(null)
            }
          }}
        />
      )}

      {(creating || editing) && (
        <AnnouncementComposer
          guildId={guildId}
          channels={channels}
          editing={editing}
          onFeedback={(kind, msg) => setFeedback({ kind, msg })}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: string
}) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}1f`, color }}>
          {icon}
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p className="font-mono text-3xl font-bold text-foreground">{value.toLocaleString()}</p>
    </div>
  )
}
