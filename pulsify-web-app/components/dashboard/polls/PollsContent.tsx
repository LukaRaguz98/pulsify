'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, Plus, CheckCircle2, AlertCircle, X, ListChecks, Radio, CalendarClock, Users, Search, History } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { computePollStats, STATUS_META, type Poll, type PollStatus } from '@/lib/polls'
import type { ActionResult } from '@/app/dashboard/[guildId]/polls/actions'
import { PollCard } from './PollCard'
import { PollDetail } from './PollDetail'
import { PollCreatePanel } from './PollCreatePanel'
import { PollAnalytics } from './PollAnalytics'

type Channel = { id: string; name: string }
type Role = { id: string; name: string; color: number }
type Tab = 'polls' | 'results'
type Feedback = { kind: 'success' | 'error'; msg: string }

const SECTIONS: PollStatus[] = ['active', 'scheduled', 'closed', 'archived']

export function PollsContent({
  guildId,
  guildName,
  initialPolls,
  channels,
  roles,
  readOnly = false,
}: {
  guildId: string
  guildName: string
  initialPolls: Poll[]
  channels: Channel[]
  roles: Role[]
  readOnly?: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('polls')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Poll | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | PollStatus>('all')
  const [historySearch, setHistorySearch] = useState('')
  const [pending, startTransition] = useTransition()

  const roleNames = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles])
  const channelNames = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels])

  // Deep links: ?new=1 opens the create panel, ?tab=results opens Results.
  // Both are cleaned from the URL so a refresh doesn't re-force them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    let changed = false
    if (!readOnly && params.get('new') === '1') {
      setCreating(true)
      params.delete('new')
      changed = true
    }
    if (!readOnly && params.get('tab') === 'results') {
      setTab('results')
      params.delete('tab')
      changed = true
    }
    if (changed) {
      const qs = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    }
  }, [readOnly])

  const selected = useMemo(() => initialPolls.find((p) => p.id === selectedId) ?? null, [initialPolls, selectedId])
  const stats = useMemo(() => computePollStats(initialPolls), [initialPolls])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return initialPolls.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (!q) return true
      return p.title.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)
    })
  }, [initialPolls, search, statusFilter])

  const grouped = useMemo(() => {
    const map = new Map<PollStatus, Poll[]>()
    for (const p of filtered) {
      const arr = map.get(p.status)
      if (arr) arr.push(p)
      else map.set(p.status, [p])
    }
    return map
  }, [filtered])

  // History = settled polls only (closed + archived), newest first.
  const history = useMemo(
    () => initialPolls.filter((p) => p.status === 'closed' || p.status === 'archived'),
    [initialPolls],
  )
  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase()
    if (!q) return history
    return history.filter((p) => p.title.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q))
  }, [history, historySearch])

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
        title="Polls"
        helpId="polls"
        description={
          readOnly ? (
            <>
              Active and recent polls in <span className="font-medium text-foreground">{guildName}</span> — vote with the
              controls on the poll post in Discord
            </>
          ) : (
            <>
              Create and run community polls for <span className="font-medium text-foreground">{guildName}</span>
            </>
          )
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

      {/* Members vote in Discord, so they only get the poll list — no results tab. */}
      {!readOnly && (
        <div className="mb-6 inline-flex rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          {([
            { id: 'polls' as Tab, label: 'Polls', icon: <ListChecks size={15} /> },
            { id: 'results' as Tab, label: 'Results', icon: <BarChart3 size={15} /> },
          ]).map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors"
                style={active ? { background: 'var(--p-soft)', color: 'var(--text)' } : { color: 'var(--text-2)' }}
              >
                <span style={active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{t.icon}</span>
                {t.label}
              </button>
            )
          })}
        </div>
      )}

      {tab === 'polls' ? (
        <div className="space-y-8">
          <CategorySection icon={<BarChart3 size={14} />} title="At a glance" description="Voting activity across this server.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={<BarChart3 size={16} />} label="Polls" value={stats.total} color="#60a5fa" />
              <StatCard icon={<Radio size={16} />} label="Active" value={stats.active} color="#22c55e" />
              <StatCard icon={<CalendarClock size={16} />} label="Scheduled" value={stats.scheduled} color="#3b82f6" />
              <StatCard icon={<Users size={16} />} label="Voters" value={stats.totalVoters} color="#a855f7" />
            </div>
          </CategorySection>

          <CategorySection icon={<ListChecks size={14} />} title="Manage" description="Browse polls and launch a new one.">
            {initialPolls.length === 0 ? (
              <EmptyState
                icon={<BarChart3 size={26} />}
                title="No polls yet"
                description={
                  readOnly
                    ? 'When the team runs a poll, it shows up here — and you can vote on the post in Discord.'
                    : 'Create your first poll — pick a type, add options, and Pulse posts it, collects votes and tallies the result.'
                }
                action={
                  readOnly ? undefined : (
                    <button
                      onClick={() => setCreating(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
                      style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
                    >
                      <Plus size={15} /> Create a poll
                    </button>
                  )
                }
              />
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative flex-1 sm:max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search polls…"
                      className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
                      style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                    />
                  </div>
                  <div className="flex items-center gap-3">
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
                    {!readOnly && (
                      <button
                        onClick={() => setCreating(true)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
                        style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
                      >
                        <Plus size={15} />
                        New poll
                      </button>
                    )}
                  </div>
                </div>

                {filtered.length === 0 ? (
                  <EmptyState variant="muted" icon={<Search size={24} />} title="No matching polls" description="Try a different search or filter." />
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
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {items.map((p) => (
                              <PollCard key={p.id} poll={p} onSelect={() => setSelectedId(p.id)} />
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
      ) : (
        <div className="space-y-8">
          <CategorySection icon={<CheckCircle2 size={14} />} title="Engagement" description="How your community participates in voting.">
            <PollAnalytics stats={stats} />
          </CategorySection>

          <CategorySection icon={<History size={14} />} title="Poll history" description="Every poll that has closed, with its final result.">
            {history.length === 0 ? (
              <EmptyState
                icon={<BarChart3 size={26} />}
                variant="muted"
                title="No closed polls yet"
                description="Once a poll closes, its result and breakdown appear here."
              />
            ) : (
              <div className="space-y-5">
                <div className="relative max-w-xs">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Search results…"
                    className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
                    style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                  />
                </div>
                {filteredHistory.length === 0 ? (
                  <EmptyState variant="muted" icon={<Search size={24} />} title="No matching results" description="Try a different search." />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredHistory.map((p) => (
                      <PollCard key={p.id} poll={p} onSelect={() => setSelectedId(p.id)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </CategorySection>
        </div>
      )}

      {selected && (
        <PollDetail
          guildId={guildId}
          poll={selected}
          roleNames={roleNames}
          channelName={channelNames.get(selected.channel_id)}
          readOnly={readOnly}
          runAction={runAction}
          onClose={() => setSelectedId(null)}
          onEdit={() => {
            setEditing(selected)
            setSelectedId(null)
          }}
        />
      )}

      {!readOnly && (creating || editing) && (
        <PollCreatePanel
          guildId={guildId}
          channels={channels}
          roles={roles}
          editing={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onDone={(msg) => setFeedback({ kind: 'success', msg })}
        />
      )}
    </div>
  )
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}1f`, color }}>{icon}</span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p className="font-mono text-3xl font-bold text-foreground">{value.toLocaleString()}</p>
    </div>
  )
}
