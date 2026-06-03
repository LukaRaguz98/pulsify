'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Award,
  Plus,
  BarChart3,
  CheckCircle2,
  AlertCircle,
  X,
  ListChecks,
  Users,
  TrendingUp,
  Search,
  Trophy,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { createClient as createSupabase } from '@/lib/supabase'
import {
  computeMilestoneStats,
  METRIC_META,
  MILESTONE_METRICS,
  type Milestone,
  type MilestoneCompletion,
  type MilestoneMetric,
} from '@/lib/milestones'
import type { ActionResult } from '@/app/dashboard/[guildId]/milestones/actions'
import type { MemberMetricRow } from '@/app/dashboard/[guildId]/milestones/page'
import { MilestoneCard } from './MilestoneCard'
import { MilestoneDetail } from './MilestoneDetail'
import { MilestoneEditPanel } from './MilestoneEditPanel'
import { MilestoneAnalytics } from './MilestoneAnalytics'
import { EligibleMembers } from './EligibleMembers'
import { MilestoneIcon } from './icons'
import { toggleMilestone } from '@/app/dashboard/[guildId]/milestones/actions'

type Channel = { id: string; name: string }
type Role = { id: string; name: string; color: number }

type Props = {
  guildId: string
  guildName: string
  initialMilestones: Milestone[]
  completions: MilestoneCompletion[]
  metrics: MemberMetricRow[]
  channels: Channel[]
  roles: Role[]
}

type Tab = 'milestones' | 'members' | 'analytics'
type Feedback = { kind: 'success' | 'error'; msg: string }

export function MilestonesContent({
  guildId,
  guildName,
  initialMilestones,
  completions,
  metrics,
  channels,
  roles,
}: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('milestones')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [search, setSearch] = useState('')
  const [metricFilter, setMetricFilter] = useState<'all' | MilestoneMetric>('all')
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const roleNames = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles])

  // Per-milestone earned counts (for cards + at-a-glance).
  const earnedById = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of completions) m.set(c.milestone_id, (m.get(c.milestone_id) ?? 0) + 1)
    return m
  }, [completions])

  const stats = useMemo(() => computeMilestoneStats(initialMilestones, completions), [initialMilestones, completions])

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

  // Realtime: refresh when milestones change or a member earns one, so the list,
  // members and analytics views update live (debounced).
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const supabase = createSupabase()
    const schedule = (ms: number) => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => startTransition(() => router.refresh()), ms)
    }
    const channel = supabase
      .channel(`milestones:${guildId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'milestones', filter: `guild_id=eq.${guildId}` }, () => schedule(800))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'member_milestones', filter: `guild_id=eq.${guildId}` }, () => schedule(2000))
      .subscribe()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [guildId, router])

  const selected = useMemo(
    () => initialMilestones.find((m) => m.id === selectedId) ?? null,
    [initialMilestones, selectedId],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return initialMilestones.filter((m) => {
      if (metricFilter !== 'all' && m.metric !== metricFilter) return false
      if (!q) return true
      return m.name.toLowerCase().includes(q) || (m.description ?? '').toLowerCase().includes(q)
    })
  }, [initialMilestones, search, metricFilter])

  // Group filtered milestones by metric for the list view.
  const grouped = useMemo(() => {
    const map = new Map<MilestoneMetric, Milestone[]>()
    for (const m of filtered) {
      const arr = map.get(m.metric)
      if (arr) arr.push(m)
      else map.set(m.metric, [m])
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

  async function onToggle(m: Milestone, enabled: boolean) {
    setTogglingId(m.id)
    await runAction(() => toggleMilestone(guildId, m.id, enabled), enabled ? 'Milestone enabled.' : 'Milestone disabled.')
    setTogglingId(null)
  }

  const usedMetrics = useMemo(
    () => MILESTONE_METRICS.filter((m) => initialMilestones.some((x) => x.metric === m)),
    [initialMilestones],
  )

  return (
    <div className="page-content">
      <PageHeader
        title="Milestones"
        description={
          <>
            Recognise and reward members of{' '}
            <span className="font-medium text-foreground">{guildName}</span> for activity and tenure
          </>
        }
        action={
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: stats.active > 0 ? '#22c55e' : 'var(--text-3)' }} />
              {stats.active} active
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
        <CategorySection icon={<Award size={14} />} title="At a glance" description="The state of member recognition in this server.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Award size={16} />} label="Milestones" value={stats.total} color="#60a5fa" />
            <StatCard icon={<CheckCircle2 size={16} />} label="Active" value={stats.active} color="#22c55e" />
            <StatCard icon={<TrendingUp size={16} />} label="Total earned" value={stats.totalEarned} color="#a855f7" />
            <StatCard
              icon={<Trophy size={16} />}
              label="Top milestone"
              value={stats.mostEarned ? stats.mostEarned.name : '—'}
              color="#f59e0b"
              text
            />
          </div>
        </CategorySection>

        {/* Workspace */}
        <CategorySection icon={<ListChecks size={14} />} title="Manage" description="Browse milestones, see who's earning them, and review impact.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              {([
                { id: 'milestones' as Tab, label: 'Milestones', icon: <ListChecks size={15} /> },
                { id: 'members' as Tab, label: 'Members', icon: <Users size={15} /> },
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
              New milestone
            </button>
          </div>

          {tab === 'milestones' &&
            (initialMilestones.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border py-16 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                  <Award size={26} />
                </div>
                <p className="font-semibold text-foreground">No milestones yet</p>
                <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
                  Create your first milestone — pick a metric and threshold, choose reward roles, and Pulse will recognise members automatically as they cross it.
                </p>
                <button onClick={() => setCreating(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white" style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}>
                  <Plus size={15} /> Create a milestone
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Search + metric filter */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative flex-1 sm:max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search milestones…"
                      className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
                      style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                    />
                  </div>
                  <div className="inline-flex flex-wrap rounded-lg border p-0.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
                    {(['all', ...usedMetrics] as const).map((f) => {
                      const active = metricFilter === f
                      const label = f === 'all' ? 'All' : METRIC_META[f].label
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setMetricFilter(f)}
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
                    <p className="font-semibold text-foreground">No matching milestones</p>
                    <p className="mt-1.5 text-sm" style={{ color: 'var(--text-3)' }}>Try a different search or filter.</p>
                  </div>
                ) : (
                  <div className="space-y-7">
                    {MILESTONE_METRICS.map((metric) => {
                      const items = grouped.get(metric)
                      if (!items || items.length === 0) return null
                      const meta = METRIC_META[metric]
                      return (
                        <section key={metric}>
                          <div className="mb-3 flex items-center gap-2">
                            <span style={{ color: 'var(--p-1)' }}><MilestoneIcon name={meta.icon} size={14} /></span>
                            <h2 className="text-sm font-semibold text-foreground">{meta.label}</h2>
                            <span className="text-xs" style={{ color: 'var(--text-3)' }}>{items.length}</span>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {items.map((m) => (
                              <MilestoneCard
                                key={m.id}
                                milestone={m}
                                earned={earnedById.get(m.id) ?? 0}
                                roleNames={roleNames}
                                onSelect={() => setSelectedId(m.id)}
                                onToggle={(enabled) => onToggle(m, enabled)}
                                busy={togglingId === m.id}
                              />
                            ))}
                          </div>
                        </section>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}

          {tab === 'members' && (
            <EligibleMembers milestones={initialMilestones} metrics={metrics} completions={completions} />
          )}

          {tab === 'analytics' && (
            <MilestoneAnalytics milestones={initialMilestones} completions={completions} />
          )}
        </CategorySection>
      </div>

      {selected && (
        <MilestoneDetail
          guildId={guildId}
          milestone={selected}
          completions={completions}
          roleNames={roleNames}
          channels={channels}
          runAction={runAction}
          onClose={() => setSelectedId(null)}
          onEdit={() => {
            setEditing(selected)
            setSelectedId(null)
          }}
        />
      )}

      {(creating || editing) && (
        <MilestoneEditPanel
          guildId={guildId}
          guildName={guildName}
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
  text,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  color: string
  text?: boolean
}) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}1f`, color }}>
          {icon}
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p className={text ? 'truncate text-lg font-bold text-foreground' : 'font-mono text-3xl font-bold text-foreground'} title={typeof value === 'string' ? value : undefined}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  )
}
