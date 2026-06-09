'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Gift, Plus, BarChart3, CheckCircle2, AlertCircle, X, ListChecks, Radio, CalendarClock, Users, Search } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import {
  computeGiveawayStats,
  STATUS_META,
  type Giveaway,
  type GiveawayStatus,
} from '@/lib/giveaways'
import type { ActionResult } from '@/app/dashboard/[guildId]/giveaways/actions'
import { GiveawayCard } from './GiveawayCard'
import { GiveawayDetail } from './GiveawayDetail'
import { GiveawayCreatePanel } from './GiveawayCreatePanel'
import { GiveawayAnalytics } from './GiveawayAnalytics'

type Channel = { id: string; name: string }
type Role = { id: string; name: string; color: number }

type Props = {
  guildId: string
  guildName: string
  initialGiveaways: Giveaway[]
  channels: Channel[]
  roles: Role[]
}

type Tab = 'giveaways' | 'analytics'
type Feedback = { kind: 'success' | 'error'; msg: string }

// Section order in the list view.
const SECTIONS: GiveawayStatus[] = ['active', 'scheduled', 'ended', 'cancelled']

export function GiveawaysContent({ guildId, guildName, initialGiveaways, channels, roles }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('giveaways')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Giveaway | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | GiveawayStatus>('all')
  const [pending, startTransition] = useTransition()

  // Resolve role + channel ids to names so requirement chips and the detail
  // drawer read like the rest of the dashboard rather than showing raw snowflakes.
  const roleNames = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles])
  const channelNames = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels])

  // Quick-action deep link (?new=1) opens the create panel once on mount.
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
    () => initialGiveaways.find((g) => g.id === selectedId) ?? null,
    [initialGiveaways, selectedId],
  )
  const stats = useMemo(() => computeGiveawayStats(initialGiveaways), [initialGiveaways])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return initialGiveaways.filter((g) => {
      if (statusFilter !== 'all' && g.status !== statusFilter) return false
      if (!q) return true
      return g.title.toLowerCase().includes(q) || g.prize.toLowerCase().includes(q)
    })
  }, [initialGiveaways, search, statusFilter])

  const grouped = useMemo(() => {
    const map = new Map<GiveawayStatus, Giveaway[]>()
    for (const g of filtered) {
      const arr = map.get(g.status)
      if (arr) arr.push(g)
      else map.set(g.status, [g])
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

  const liveCount = stats.active + stats.scheduled

  return (
    <div className="page-content">
      <PageHeader
        title="Giveaways"
        helpId="giveaways"
        description={
          <>
            Run interactive giveaways for{' '}
            <span className="font-medium text-foreground">{guildName}</span>
          </>
        }
        action={
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: liveCount > 0 ? '#22c55e' : 'var(--text-3)' }} />
              {liveCount} live
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
          icon={<Gift size={14} />}
          title="At a glance"
          description="The state of giveaways and engagement in this server."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Gift size={16} />} label="Giveaways" value={stats.total} color="#60a5fa" />
            <StatCard icon={<Radio size={16} />} label="Active" value={stats.active} color="#22c55e" />
            <StatCard icon={<CalendarClock size={16} />} label="Scheduled" value={stats.scheduled} color="#3b82f6" />
            <StatCard icon={<Users size={16} />} label="Entries" value={stats.totalEntries} color="#a855f7" />
          </div>
        </CategorySection>

        {/* Workspace: tabs + create + content */}
        <CategorySection
          icon={<ListChecks size={14} />}
          title="Manage"
          description="Browse giveaways, launch a new one, and review engagement."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              {([
                { id: 'giveaways' as Tab, label: 'Giveaways', icon: <ListChecks size={15} /> },
                { id: 'analytics' as Tab, label: 'Analytics', icon: <BarChart3 size={15} /> },
              ]).map((t) => {
                const active = tab === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors"
                    style={active ? { background: 'var(--p-soft)', color: 'var(--text)', boxShadow: 'inset 0 0 0 1px var(--p-soft)' } : { color: 'var(--text-2)' }}
                  >
                    <span style={active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{t.icon}</span>
                    {t.label}
                    {t.id === 'giveaways' && liveCount > 0 && (
                      <span className="ml-1 rounded-full px-1.5 text-[10px] font-bold" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
                        {liveCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
            >
              <Plus size={15} />
              New giveaway
            </button>
          </div>

          {tab === 'giveaways' &&
            (initialGiveaways.length === 0 ? (
              <EmptyState
                icon={<Gift size={26} />}
                title="No giveaways yet"
                description="Create your first giveaway — pick a prize, set a duration, and Pulse will post it, track entries and draw winners automatically."
                action={
                  <button
                    onClick={() => setCreating(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
                    style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
                  >
                    <Plus size={15} /> Create a giveaway
                  </button>
                }
              />
            ) : (
              <div className="space-y-5">
                {/* Search + status filter — same row layout as the Scheduled view */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative flex-1 sm:max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search giveaways…"
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
                  <EmptyState
                    variant="muted"
                    icon={<Search size={24} />}
                    title="No matching giveaways"
                    description="Try a different search or filter."
                  />
                ) : (
                  <div className="space-y-7">
                    {SECTIONS.map((status) => {
                      const items = grouped.get(status)
                      if (!items || items.length === 0) return null
                      const meta = STATUS_META[status]
                      return (
                        <section key={status}>
                          <div className="mb-3 flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
                            <h2 className="text-sm font-semibold text-foreground">{meta.label}</h2>
                            <span className="text-xs" style={{ color: 'var(--text-3)' }}>{items.length}</span>
                          </div>
                          <div className="giveaway-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {items.map((g) => (
                              <GiveawayCard key={g.id} giveaway={g} roleNames={roleNames} onSelect={() => setSelectedId(g.id)} />
                            ))}
                          </div>
                        </section>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}

          {tab === 'analytics' && <GiveawayAnalytics stats={stats} />}
        </CategorySection>
      </div>

      {selected && (
        <GiveawayDetail
          guildId={guildId}
          giveaway={selected}
          roleNames={roleNames}
          channelName={channelNames.get(selected.channel_id)}
          runAction={runAction}
          onClose={() => setSelectedId(null)}
          onEdit={() => {
            setEditing(selected)
            setSelectedId(null)
          }}
        />
      )}

      {(creating || editing) && (
        <GiveawayCreatePanel
          guildId={guildId}
          channels={channels}
          roles={roles}
          editing={editing}
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
