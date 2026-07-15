'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { UserPlus, Trophy, Users2, TrendingUp, ShieldAlert, Settings, LineChart, Clock, AlertCircle, CheckCircle2, UserMinus, Gift } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { createClient as createSupabase } from '@/lib/supabase'
import {
  computeInviteStats,
  joinSeries,
  aggregateInviters,
  buildLeaderboard,
  bonusByUser,
  statusLabel,
  reasonLabel,
  SOURCE_META,
  type InviteConfig,
  type InviteAdjustment,
  type InvitedMember,
} from '@/lib/invites'
import { STATUS_COLOR } from './icons'
import { InviteLeaderboard } from './InviteLeaderboard'
import { InviteMembers } from './InviteMembers'
import { InviteAdmin } from './InviteAdmin'

export type Role = { id: string; name: string; color: number }

type Props = {
  guildId: string
  guildName: string
  config: InviteConfig
  members: InvitedMember[]
  adjustments: InviteAdjustment[]
  roles: Role[]
}

type Tab = 'overview' | 'leaderboard' | 'members'
export type Feedback = { kind: 'success' | 'error'; msg: string }

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <TrendingUp size={15} /> },
  { key: 'leaderboard', label: 'Leaderboard', icon: <Trophy size={15} /> },
  { key: 'members', label: 'Invited members', icon: <Users2 size={15} /> },
]

export function InvitesContent({ guildId, guildName, config, members, adjustments, roles }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [pending, startTransition] = useTransition()

  const roleNames = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles])
  const stats = useMemo(() => computeInviteStats(members, adjustments), [members, adjustments])
  const settingsHref = `/dashboard/${guildId}/invite-settings`

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && TABS.some((x) => x.key === t)) setTab(t)
  }, [])

  function selectTab(next: Tab) {
    setTab(next)
    const params = new URLSearchParams(window.location.search)
    if (next === 'overview') params.delete('tab')
    else params.set('tab', next)
    const qs = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
  }

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const supabase = createSupabase()
    const schedule = (ms: number) => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => startTransition(() => router.refresh()), ms)
    }
    const channel = supabase
      .channel(`invites:${guildId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invited_members', filter: `guild_id=eq.${guildId}` }, () => schedule(1500))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invite_adjustments', filter: `guild_id=eq.${guildId}` }, () => schedule(1000))
      .subscribe()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [guildId, router])

  useEffect(() => {
    if (!feedback) return
    const t = setTimeout(() => setFeedback(null), 4000)
    return () => clearTimeout(t)
  }, [feedback])

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router])

  const topInviters = useMemo(() => {
    const agg = aggregateInviters(members, null)
    return buildLeaderboard(agg, { bonusByUser: bonusByUser(adjustments) }).slice(0, 5)
  }, [members, adjustments])

  const recent = useMemo(() => members.filter((m) => !m.is_bonus).slice(0, 8), [members])
  const series = useMemo(() => joinSeries(members, 14), [members])

  return (
    <div className="page-content">
      <PageHeader
        title="Invites"
        helpId="invites"
        description={
          <>
            Track referrals, reward top inviters and stop invite farming in{' '}
            <span className="font-medium text-foreground">{guildName}</span>
          </>
        }
        action={
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
              title={config.enabled ? 'Invite tracking is on' : 'Invite tracking is off'}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: config.enabled ? '#22c55e' : 'var(--text-3)' }} />
              {config.enabled ? 'Tracking on' : 'Tracking off'}
            </span>
            <RefreshButton onClick={refresh} refreshing={pending} />
            <Link
              href={settingsHref}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <Settings size={12} />
              Invite settings
            </Link>
          </div>
        }
      />

      {feedback && (
        <div
          className="mb-4 rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor: feedback.kind === 'success' ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
            background: feedback.kind === 'success' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            color: feedback.kind === 'success' ? '#22c55e' : '#f87171',
          }}
        >
          {feedback.msg}
        </div>
      )}

      <div className="mb-6 inline-flex flex-wrap rounded-xl border p-1" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              style={active ? { background: 'var(--p-soft)', color: 'var(--p-1)' } : { color: 'var(--text-2)' }}
            >
              {t.icon}
              {t.label}
            </button>
          )
        })}
      </div>

      {!config.enabled && (
        <div
          className="mb-6 flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}
        >
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              Invite tracking is currently <span className="font-semibold">off</span>. Joins are still recorded, but
              they aren&apos;t scored or attributed until you turn it on.
            </span>
          </div>
          <Link
            href={settingsHref}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border px-2.5 py-1 text-xs font-medium transition"
            style={{ borderColor: 'rgba(245,158,11,0.4)', color: '#f59e0b' }}
          >
            Open settings
          </Link>
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-8">
          <CategorySection icon={<TrendingUp size={14} />} title="At a glance" description="How referrals are performing across the server right now.">
            <StatGrid stats={stats} />
          </CategorySection>

          <CategorySection icon={<LineChart size={14} />} title="Growth" description="Joins over the last two weeks and your strongest recruiters.">
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                <h3 className="mb-4 text-sm font-semibold text-foreground">Joins — last 14 days</h3>
                <JoinChart series={series} />
              </div>
              <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                <h3 className="mb-4 text-sm font-semibold text-foreground">Top inviters</h3>
                {topInviters.length === 0 ? (
                  <p className="text-sm text-subtle">No tracked invites yet.</p>
                ) : (
                  <ol className="space-y-2.5">
                    {topInviters.map((r, i) => (
                      <li key={r.inviter_id} className="flex items-center gap-2.5 text-sm">
                        <span className="w-5 text-center font-bold" style={{ color: i < 3 ? 'var(--p-1)' : 'var(--text-3)' }}>{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-foreground">{r.inviter_name ?? `User ${r.inviter_id.slice(0, 6)}`}</span>
                        <span className="font-semibold text-foreground">{r.score}</span>
                        <span className="text-xs text-subtle">{r.valid} valid</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </CategorySection>

          <CategorySection icon={<Clock size={14} />} title="Recent invited members" description="The latest joins attributed to an invite.">
            <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
              {recent.length === 0 ? (
                <EmptyState icon={<UserPlus size={22} />} title="No invited members yet" description="Once members join through a tracked invite, they'll appear here." variant="muted" />
              ) : (
                <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
                  {recent.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate text-foreground">{m.user_name ?? `User ${m.user_id.slice(0, 6)}`}</span>
                      <span className="text-xs text-subtle">
                        {m.inviter_id ? `by ${m.inviter_name ?? `User ${m.inviter_id.slice(0, 6)}`}` : SOURCE_META[m.source]}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${STATUS_COLOR[m.status]}1f`, color: STATUS_COLOR[m.status] }}>
                        {statusLabel(m.status)}
                      </span>
                      {m.fake_reason && <span className="text-[11px] text-subtle">{reasonLabel(m.fake_reason)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CategorySection>
        </div>
      )}

      {tab === 'leaderboard' && (
        <CategorySection icon={<Trophy size={14} />} title="Invite leaderboard" description="Rank inviters by score for any time range, and open a profile for the details.">
          <InviteLeaderboard members={members} adjustments={adjustments} roleNames={roleNames} />
        </CategorySection>
      )}

      {tab === 'members' && (
        <div className="space-y-8">
          <CategorySection icon={<Users2 size={14} />} title="Invited members" description="Every attributed join, with the status and admin actions.">
            <InviteMembers guildId={guildId} members={members} setFeedback={setFeedback} onDone={refresh} />
          </CategorySection>
          <InviteAdmin guildId={guildId} adjustments={adjustments} setFeedback={setFeedback} onDone={refresh} />
        </div>
      )}
    </div>
  )
}

// ── Overview building blocks ────────────────────────────────────────────────

function StatGrid({ stats }: { stats: ReturnType<typeof computeInviteStats> }) {
  const tiles: { label: string; value: number | string; icon: React.ReactNode; color: string; hint?: string }[] = [
    { label: 'Invite score', value: stats.score, icon: <Trophy size={16} />, color: '#60a5fa', hint: 'valid + bonus − fake' },
    { label: 'Valid', value: stats.valid, icon: <CheckCircle2 size={16} />, color: '#22c55e' },
    { label: 'Pending', value: stats.pending, icon: <Clock size={16} />, color: '#f59e0b' },
    { label: 'Fake', value: stats.fake, icon: <ShieldAlert size={16} />, color: '#ef4444' },
    { label: 'Left', value: stats.left, icon: <UserMinus size={16} />, color: '#94a3b8' },
    { label: 'Bonus', value: stats.bonus, icon: <Gift size={16} />, color: '#38bdf8' },
    { label: 'Retention', value: `${stats.retentionRate}%`, icon: <TrendingUp size={16} />, color: '#a855f7', hint: `${stats.retained} of ${stats.valid} valid still here` },
    { label: 'Inviters', value: stats.inviters, icon: <Users2 size={16} />, color: '#14b8a6' },
  ]
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {tiles.map((t) => (
        <StatCard key={t.label} icon={t.icon} label={t.label} value={t.value} color={t.color} hint={t.hint} />
      ))}
    </div>
  )
}

function StatCard({ icon, label, value, color, hint }: { icon: React.ReactNode; label: string; value: number | string; color: string; hint?: string }) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }} title={hint}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}1f`, color }}>
          {icon}
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p className="font-mono text-3xl font-bold text-foreground">{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}

function JoinChart({ series }: { series: { date: string; total: number; valid: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.total))
  return (
    <div>
      <div className="flex h-32 items-end gap-1.5">
        {series.map((s) => (
          <div key={s.date} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${s.date}: ${s.total} joins (${s.valid} valid)`}>
            <div className="relative flex w-full items-end justify-center rounded-t" style={{ height: `${Math.max(2, (s.total / max) * 100)}%`, background: 'color-mix(in srgb, var(--p-1) 22%, transparent)' }}>
              <div className="absolute inset-x-0 bottom-0 rounded-t" style={{ height: `${s.total > 0 ? Math.max(4, (s.valid / s.total) * 100) : 0}%`, background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-subtle">
        <span>{series[0]?.date.slice(5)}</span>
        <span>Valid joins highlighted</span>
        <span>{series[series.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  )
}
