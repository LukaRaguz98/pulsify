'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Siren,
  Activity,
  ShieldAlert,
  Search,
  Lock,
  Unlock,
  AlertTriangle,
  Users,
  Ban,
  Wrench,
  CheckCircle2,
  Plus,
  FlaskConical,
  Settings,
  ScrollText,
} from 'lucide-react'
import { createClient as createSupabase } from '@/lib/supabase'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { SecurityIcon, SeverityBadge, StatusBadge } from '@/components/dashboard/security/icons'
import {
  normaliseEvent,
  normaliseMitigationRow,
  computeSecurityStats,
  protectionStatus,
  STATUS_META,
  PATTERN_META,
  MITIGATION_META,
  MODULE_LABELS,
  ALL_MITIGATIONS,
  ALL_PATTERNS,
  SEVERITY_META,
  describeEvent,
  timeAgo,
  type SecurityConfig,
  type SecurityEvent,
  type SecurityMitigation,
  type SecuritySeverity,
  type SecurityPattern,
  type SecurityModule,
} from '@/lib/security'
import {
  endMitigation,
  resolveEvent,
  resolveAllEvents,
  setLockdown,
  triggerManualMitigation,
  simulateDetection,
} from '@/app/dashboard/[guildId]/(management)/security/actions'

type Tab = 'overview' | 'logs'

export function SecurityContent({
  guildId,
  guildName,
  initialConfig,
  initialEvents,
  initialMitigations,
  settingsHref,
}: {
  guildId: string
  guildName: string
  initialConfig: SecurityConfig
  initialEvents: SecurityEvent[]
  initialMitigations: SecurityMitigation[]
  settingsHref: string
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [config, setConfig] = useState(initialConfig)
  const [events, setEvents] = useState(initialEvents)
  const [mitigations, setMitigations] = useState(initialMitigations)
  const [refreshing, startRefresh] = useTransition()
  const [pending, startAction] = useTransition()
  const [actionError, setActionError] = useState<string | null>(null)

  // Dialog state
  const [lockdownDialog, setLockdownDialog] = useState(false)
  const [manualDialog, setManualDialog] = useState(false)
  const [simulateDialog, setSimulateDialog] = useState(false)
  const [endingMitigation, setEndingMitigation] = useState<SecurityMitigation | null>(null)

  const supabase = useMemo(() => createSupabase(), [])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refetch = useCallback(async () => {
    const [{ data: cfg }, { data: ev }, { data: mit }] = await Promise.all([
      supabase.from('security_configs').select('*').eq('guild_id', guildId).maybeSingle(),
      supabase.from('security_events').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(500),
      supabase.from('security_mitigations').select('*').eq('guild_id', guildId).order('started_at', { ascending: false }).limit(500),
    ])
    if (cfg !== undefined) {
      const { normaliseConfig } = await import('@/lib/security')
      setConfig(normaliseConfig(cfg as Record<string, unknown> | null))
    }
    if (ev) setEvents(ev.map((r) => normaliseEvent(r as Record<string, unknown>)))
    if (mit) setMitigations(mit.map((r) => normaliseMitigationRow(r as Record<string, unknown>)))
  }, [supabase, guildId])

  useEffect(() => {
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void refetch(), 600)
    }
    const channel = supabase
      .channel(`security:${guildId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'security_events', filter: `guild_id=eq.${guildId}` }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'security_mitigations', filter: `guild_id=eq.${guildId}` }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'security_configs', filter: `guild_id=eq.${guildId}` }, schedule)
      .subscribe()
    return () => {
      if (timer.current) clearTimeout(timer.current)
      void supabase.removeChannel(channel)
    }
  }, [supabase, guildId, refetch])

  const refresh = useCallback(() => {
    startRefresh(async () => {
      await refetch()
      router.refresh()
    })
  }, [refetch, router])

  const openEvents = useMemo(() => events.filter((e) => e.status !== 'resolved'), [events])
  const activeMitigations = useMemo(() => mitigations.filter((m) => m.active), [mitigations])
  const stats = useMemo(() => computeSecurityStats(events, mitigations), [events, mitigations])
  const status = protectionStatus(config, openEvents)
  const statusMeta = STATUS_META[status]

  function runAction(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, onDone?: () => void) {
    setActionError(null)
    startAction(async () => {
      const res = await fn()
      if (res.ok) {
        await refetch()
        onDone?.()
      } else {
        setActionError(res.error)
      }
    })
  }

  const header = (
    <PageHeader
      title="DDoS Protection"
      helpId="ddos-protection"
      description={
        <>
          Monitor, detect and respond to suspicious traffic and abuse across{' '}
          <span className="font-medium text-foreground">{guildName || 'this server'}</span> — protecting Pulse and Pulsify workflows from spikes, raids and automated abuse.
        </>
      }
      action={
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: config.enabled ? '#22c55e' : 'var(--text-3)' }} />
            {config.enabled ? 'Enabled' : 'Off'}
          </span>
          {config.lockdown_active ? (
            <button
              type="button"
              onClick={() => setLockdownDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: '#ef4444' }}
            >
              <Unlock size={13} /> Lift lockdown
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setLockdownDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}
            >
              <Lock size={13} /> Lockdown
            </button>
          )}
          <Link
            href={settingsHref}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <Settings size={12} /> DDoS Protection settings
          </Link>
          <RefreshButton onClick={refresh} refreshing={refreshing} />
        </div>
      }
    />
  )

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Activity size={15} /> },
    { id: 'logs', label: 'Logs', icon: <ScrollText size={15} /> },
  ]

  return (
    <div className="page-content">
      {header}

      {/* Page-level tabs (Members/Polls style) */}
      <div className="mb-6 inline-flex rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        {tabs.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
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

      {actionError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> <span>{actionError}</span>
        </div>
      )}

      {tab === 'overview' && (
        <OverviewTab
          guildId={guildId}
          config={config}
          statusMeta={statusMeta}
          stats={stats}
          openEvents={openEvents}
          activeMitigations={activeMitigations}
          pending={pending}
          settingsHref={settingsHref}
          onAddMitigation={() => { setActionError(null); setManualDialog(true) }}
          onSimulate={() => { setActionError(null); setSimulateDialog(true) }}
          onEndMitigation={(m) => { setActionError(null); setEndingMitigation(m) }}
          onResolve={(id) => runAction(() => resolveEvent(guildId, id))}
        />
      )}

      {tab === 'logs' && (
        <LogsTab
          guildId={guildId}
          stats={stats}
          events={events}
          mitigations={mitigations}
          onResolve={(id) => runAction(() => resolveEvent(guildId, id))}
          onResolveAll={() => runAction(() => resolveAllEvents(guildId))}
          onEndMitigation={(m) => { setActionError(null); setEndingMitigation(m) }}
        />
      )}

      {/* ── Dialogs ───────────────────────────────────────────── */}
      {lockdownDialog && (
        <ConfirmDialog
          title={config.lockdown_active ? 'Lift server lockdown?' : 'Enable server lockdown?'}
          description={
            config.lockdown_active
              ? 'Pulse-driven actions resume immediately for everyone.'
              : 'This blocks all Pulse-driven actions server-wide until you lift it. Use it to stop an active attack.'
          }
          tone={config.lockdown_active ? 'default' : 'destructive'}
          confirmLabel={config.lockdown_active ? 'Lift lockdown' : 'Enable lockdown'}
          busy={pending}
          error={actionError}
          fields={config.lockdown_active ? [] : [{ key: 'reason', kind: 'text', label: 'Reason (optional)', placeholder: 'e.g. Coordinated raid in progress' }]}
          onCancel={() => setLockdownDialog(false)}
          onConfirm={(v) =>
            runAction(() => setLockdown(guildId, !config.lockdown_active, v.reason || null), () => setLockdownDialog(false))
          }
        />
      )}

      {manualDialog && (
        <ManualMitigationDialog
          busy={pending}
          error={actionError}
          onCancel={() => setManualDialog(false)}
          onConfirm={(input) => runAction(() => triggerManualMitigation(guildId, input), () => setManualDialog(false))}
        />
      )}

      {simulateDialog && (
        <ConfirmDialog
          title="Run a test detection"
          description="Raises a simulated security event so you can confirm the monitoring view and alerts work. No mitigation is applied."
          confirmLabel="Raise test alert"
          busy={pending}
          error={actionError}
          fields={[
            { key: 'pattern', kind: 'select', label: 'Pattern', defaultValue: 'request_spike', options: ALL_PATTERNS.map((p) => ({ label: PATTERN_META[p].label, value: p })) },
            { key: 'severity', kind: 'select', label: 'Severity', defaultValue: 'high', options: (['low', 'medium', 'high', 'critical'] as SecuritySeverity[]).map((s) => ({ label: SEVERITY_META[s].label, value: s })) },
          ]}
          onCancel={() => setSimulateDialog(false)}
          onConfirm={(v) =>
            runAction(
              () => simulateDetection(guildId, v.pattern as SecurityPattern, v.severity as SecuritySeverity),
              () => setSimulateDialog(false),
            )
          }
        />
      )}

      {endingMitigation && (
        <ConfirmDialog
          title="Lift this mitigation?"
          description={`${MITIGATION_META[endingMitigation.action].label} will be removed and normal operation resumes for the affected scope.`}
          confirmLabel="Lift mitigation"
          busy={pending}
          error={actionError}
          onCancel={() => setEndingMitigation(null)}
          onConfirm={() => runAction(() => endMitigation(guildId, endingMitigation.id), () => setEndingMitigation(null))}
        />
      )}
    </div>
  )
}

// ── Overview tab ───────────────────────────────────────────────────────────────

function OverviewTab({
  config,
  statusMeta,
  stats,
  openEvents,
  activeMitigations,
  pending,
  settingsHref,
  onAddMitigation,
  onSimulate,
  onEndMitigation,
  onResolve,
}: {
  guildId: string
  config: SecurityConfig
  statusMeta: (typeof STATUS_META)[keyof typeof STATUS_META]
  stats: ReturnType<typeof computeSecurityStats>
  openEvents: SecurityEvent[]
  activeMitigations: SecurityMitigation[]
  pending: boolean
  settingsHref: string
  onAddMitigation: () => void
  onSimulate: () => void
  onEndMitigation: (m: SecurityMitigation) => void
  onResolve: (id: string) => void
}) {
  if (!config.enabled && openEvents.length === 0 && stats.totalEvents === 0) {
    return (
      <EmptyState
        icon={<Siren size={26} />}
        title="DDoS Protection is off"
        description="Turn it on in DDoS Protection settings — Pulse will start monitoring traffic, detecting abuse patterns and applying the protection rules and mitigations you configure."
        action={
          <Link
            href={settingsHref}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
          >
            <Settings size={15} /> Configure in settings
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-8">
      {/* Status banner */}
      <div
        className="flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between"
        style={{ background: 'var(--panel)', borderColor: `${statusMeta.color}55` }}
      >
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ background: `${statusMeta.color}1f`, color: statusMeta.color }}>
            <SecurityIcon name={statusMeta.icon} size={24} />
          </span>
          <div>
            <p className="text-lg font-bold" style={{ color: statusMeta.color }}>{statusMeta.label}</p>
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>{config.lockdown_active && config.lockdown_reason ? config.lockdown_reason : statusMeta.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onSimulate} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
            <FlaskConical size={13} /> Test alert
          </button>
          <button type="button" onClick={onAddMitigation} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}>
            <Plus size={13} /> Apply mitigation
          </button>
        </div>
      </div>

      {/* At a glance */}
      <CategorySection icon={<Activity size={14} />} title="At a glance" description="Detection and mitigation activity across this server.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<ShieldAlert size={16} />} label="Open events" value={stats.open} color="#f59e0b" />
          <StatCard icon={<Ban size={16} />} label="High / critical" value={stats.bySeverity.high + stats.bySeverity.critical} color="#ef4444" />
          <StatCard icon={<Wrench size={16} />} label="Active mitigations" value={stats.activeMitigations} color="#3b82f6" />
          <StatCard icon={<Users size={16} />} label="Suspicious users" value={stats.suspiciousUsers} color="#a855f7" />
        </div>
      </CategorySection>

      {/* Activity spikes graph */}
      <CategorySection icon={<Activity size={14} />} title="Activity spikes" description="Detected security events per hour over the last 24 hours.">
        <ActivityChart series={stats.series} />
      </CategorySection>

      {/* Active mitigations */}
      <CategorySection icon={<Wrench size={14} />} title="Mitigation status" description="Protections currently in force — automatic and manual.">
        {activeMitigations.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={20} />} title="No active mitigations" description="Nothing is being throttled or blocked right now." variant="muted" />
        ) : (
          <div className="space-y-2">
            {activeMitigations.map((m) => (
              <MitigationRow key={m.id} m={m} pending={pending} onEnd={() => onEndMitigation(m)} />
            ))}
          </div>
        )}
      </CategorySection>

      {/* Recent suspicious activity */}
      <CategorySection icon={<ShieldAlert size={14} />} title="Recent suspicious activity" description="The latest open detections — resolve them once investigated.">
        {openEvents.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={20} />} title="All clear" description="No open suspicious activity. Pulse keeps watching in the background." variant="muted" />
        ) : (
          <div className="space-y-2">
            {openEvents.slice(0, 8).map((e) => (
              <EventRow key={e.id} e={e} pending={pending} onResolve={() => onResolve(e.id)} />
            ))}
          </div>
        )}
      </CategorySection>
    </div>
  )
}

// ── Logs tab ────────────────────────────────────────────────────────────────

function LogsTab({
  stats,
  events,
  mitigations,
  onResolve,
  onResolveAll,
  onEndMitigation,
}: {
  guildId: string
  stats: ReturnType<typeof computeSecurityStats>
  events: SecurityEvent[]
  mitigations: SecurityMitigation[]
  onResolve: (id: string) => void
  onResolveAll: () => void
  onEndMitigation: (m: SecurityMitigation) => void
}) {
  const [view, setView] = useState<'events' | 'mitigations'>('events')
  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState<'all' | SecuritySeverity>('all')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events.filter((e) => {
      if (severity !== 'all' && e.severity !== severity) return false
      if (!q) return true
      return (
        PATTERN_META[e.pattern].label.toLowerCase().includes(q) ||
        MODULE_LABELS[e.module].toLowerCase().includes(q) ||
        (e.actor_name ?? '').toLowerCase().includes(q) ||
        (e.actor_id ?? '').includes(q)
      )
    })
  }, [events, search, severity])

  const filteredMitigations = useMemo(() => {
    const q = search.trim().toLowerCase()
    return mitigations.filter((m) => {
      if (!q) return true
      return (
        MITIGATION_META[m.action].label.toLowerCase().includes(q) ||
        (m.reason ?? '').toLowerCase().includes(q) ||
        (m.target_user_name ?? '').toLowerCase().includes(q) ||
        (m.target_user_id ?? '').includes(q)
      )
    })
  }, [mitigations, search])

  const total = view === 'events' ? filteredEvents.length : filteredMitigations.length
  const pageEvents = filteredEvents.slice(page * pageSize, page * pageSize + pageSize)
  const pageMitigations = filteredMitigations.slice(page * pageSize, page * pageSize + pageSize)

  const subTab = (id: 'events' | 'mitigations', label: string, icon: React.ReactNode, count: number) => {
    const active = view === id
    return (
      <button
        key={id}
        type="button"
        onClick={() => { setView(id); setPage(0) }}
        className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors"
        style={active ? { background: 'var(--p-soft)', color: 'var(--text)' } : { color: 'var(--text-2)' }}
      >
        <span style={active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{icon}</span>
        {label}
        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>{count}</span>
      </button>
    )
  }

  return (
    <div className="space-y-8">
      {/* At a glance */}
      <CategorySection icon={<Activity size={14} />} title="At a glance" description="Detection and mitigation totals for this server.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<ShieldAlert size={16} />} label="Total events" value={stats.totalEvents} color="#60a5fa" />
          <StatCard icon={<Ban size={16} />} label="High / critical" value={stats.bySeverity.high + stats.bySeverity.critical} color="#ef4444" />
          <StatCard icon={<Wrench size={16} />} label="Mitigations" value={mitigations.length} color="#3b82f6" />
          <StatCard icon={<Users size={16} />} label="Suspicious users" value={stats.suspiciousUsers} color="#a855f7" />
        </div>
      </CategorySection>

      <CategorySection
        icon={<ScrollText size={14} />}
        title="Investigation"
        description="Search and filter every detected event and mitigation action."
        action={
          view === 'events' && events.some((e) => e.status !== 'resolved') ? (
            <button type="button" onClick={onResolveAll} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
              <CheckCircle2 size={13} /> Resolve all
            </button>
          ) : undefined
        }
      >
      <div className="space-y-4">
      <div className="inline-flex rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        {subTab('events', 'Detected events', <ShieldAlert size={15} />, events.length)}
        {subTab('mitigations', 'Mitigation log', <Wrench size={15} />, mitigations.length)}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-xs flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            placeholder={view === 'events' ? 'Search pattern, module or member…' : 'Search action, reason or member…'}
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--p-1)]"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-1)' }}
          />
        </div>
        {view === 'events' && (
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'low', 'medium', 'high', 'critical'] as const).map((s) => {
              const active = severity === s
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setSeverity(s); setPage(0) }}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition"
                  style={{ background: active ? 'var(--p-soft)' : 'var(--bg-2)', borderColor: active ? 'var(--p-1)' : 'var(--line-strong)', color: active ? 'var(--p-1)' : 'var(--text-2)' }}
                >
                  {s}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {total === 0 ? (
        <EmptyState
          icon={view === 'events' ? <ShieldAlert size={20} /> : <Wrench size={20} />}
          title={search || severity !== 'all' ? 'Nothing matches your filters' : view === 'events' ? 'No detected events yet' : 'No mitigations yet'}
          description={search || severity !== 'all' ? 'Try a different search or filter.' : 'Events and actions will appear here as Pulse detects and responds to abuse.'}
          variant="muted"
        />
      ) : view === 'events' ? (
        <div className="space-y-2">
          {pageEvents.map((e) => (
            <EventRow key={e.id} e={e} pending={false} onResolve={() => onResolve(e.id)} detailed />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {pageMitigations.map((m) => (
            <MitigationRow key={m.id} m={m} pending={false} onEnd={() => onEndMitigation(m)} detailed />
          ))}
        </div>
      )}

      {total > pageSize && (
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(0) }} />
      )}
      </div>
      </CategorySection>
    </div>
  )
}

// ── Rows ────────────────────────────────────────────────────────────────────

function EventRow({ e, pending, onResolve, detailed }: { e: SecurityEvent; pending: boolean; onResolve: () => void; detailed?: boolean }) {
  const meta = PATTERN_META[e.pattern]
  return (
    <div className="flex items-start gap-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: SEVERITY_META[e.severity].bg, color: SEVERITY_META[e.severity].color }}>
        <SecurityIcon name={meta.icon} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{meta.label}</span>
          <SeverityBadge severity={e.severity} />
          <StatusBadge status={e.status} />
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>{MODULE_LABELS[e.module]}</span>
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-2)' }}>
          {e.details?.simulated ? `${meta.label} (simulated test).` : describeEvent(e)}
        </p>
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
          {timeAgo(e.created_at)}
          {detailed && ` · ${new Date(e.created_at).toLocaleString()}`}
          {e.actor_name && ` · ${e.actor_name}`}
          {e.source === 'manual' && ' · manual'}
        </p>
      </div>
      {e.status !== 'resolved' && (
        <button type="button" disabled={pending} onClick={onResolve} className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition hover:bg-[var(--bg-2)] disabled:opacity-50" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
          <CheckCircle2 size={12} /> Resolve
        </button>
      )}
    </div>
  )
}

function MitigationRow({ m, pending, onEnd, detailed }: { m: SecurityMitigation; pending: boolean; onEnd: () => void; detailed?: boolean }) {
  const meta = MITIGATION_META[m.action]
  const target =
    m.target_user_name || (m.target_user_id ? `<@${m.target_user_id}>` : null) ||
    (m.module ? MODULE_LABELS[m.module] : null) ||
    'server-wide'
  return (
    <div className="flex items-start gap-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: m.active ? `${SEVERITY_META[meta.tone].color}40` : 'var(--line-strong)' }}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: SEVERITY_META[meta.tone].bg, color: SEVERITY_META[meta.tone].color }}>
        <SecurityIcon name={meta.icon} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{meta.label}</span>
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>{target}</span>
          {m.active ? (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>Active</span>
          ) : (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>Ended</span>
          )}
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium capitalize" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>{m.source}</span>
        </div>
        {m.reason && <p className="mt-1 text-xs" style={{ color: 'var(--text-2)' }}>{m.reason}</p>}
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
          {timeAgo(m.started_at)}
          {detailed && ` · started ${new Date(m.started_at).toLocaleString()}`}
          {m.active && m.expires_at && ` · expires ${timeAgo(m.expires_at).replace(' ago', '')} from start`}
          {!m.active && m.ended_at && ` · ended ${timeAgo(m.ended_at)}`}
        </p>
      </div>
      {m.active && (
        <button type="button" disabled={pending} onClick={onEnd} className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition hover:bg-[var(--bg-2)] disabled:opacity-50" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
          <Unlock size={12} /> Lift
        </button>
      )}
    </div>
  )
}

// ── Activity chart (simple inline bars) ───────────────────────────────────────

function ActivityChart({ series }: { series: { hour: string; count: number; high: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.count))
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="flex h-32 items-end gap-1">
        {series.map((s) => {
          const h = Math.round((s.count / max) * 100)
          const hot = s.high > 0
          return (
            <div key={s.hour} className="group relative flex flex-1 flex-col justify-end" style={{ minWidth: 2 }} title={`${new Date(s.hour + ':00:00').toLocaleString([], { hour: 'numeric' })} — ${s.count} event${s.count === 1 ? '' : 's'}`}>
              <div
                className="rounded-t transition-all"
                style={{ height: `${Math.max(s.count > 0 ? 6 : 2, h)}%`, background: s.count === 0 ? 'var(--line-strong)' : hot ? '#ef4444' : 'var(--p-1)', opacity: s.count === 0 ? 0.4 : 1 }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px]" style={{ color: 'var(--text-3)' }}>
        <span>24h ago</span>
        <span>now</span>
      </div>
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

// ── Manual mitigation dialog (uses the shared ConfirmDialog field model) ──────

function ManualMitigationDialog({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (input: {
    action: SecurityMitigation['action']
    module?: SecurityModule | null
    target_user_id?: string | null
    duration_minutes: number
    reason?: string | null
  }) => void
}) {
  return (
    <ConfirmDialog
      title="Apply a mitigation"
      description="Manually apply a protection action. User actions need a member ID; module actions need a target module."
      tone="warning"
      confirmLabel="Apply mitigation"
      busy={busy}
      error={error}
      fields={[
        { key: 'action', kind: 'select', label: 'Action', defaultValue: 'pause_module', options: ALL_MITIGATIONS.filter((a) => a !== 'notify').map((a) => ({ label: MITIGATION_META[a].label, value: a })) },
        { key: 'module', kind: 'select', label: 'Target module (for module actions)', defaultValue: 'commands', options: (Object.keys(MODULE_LABELS) as (keyof typeof MODULE_LABELS)[]).map((m) => ({ label: MODULE_LABELS[m], value: m })) },
        { key: 'target_user_id', kind: 'text', label: 'Target member ID (for user actions)', placeholder: 'e.g. 123456789012345678' },
        { key: 'duration_minutes', kind: 'number', label: 'Duration in minutes (0 = until lifted)', defaultValue: 30, min: 0 },
        { key: 'reason', kind: 'text', label: 'Reason (optional)', placeholder: 'Why are you applying this?' },
      ]}
      onCancel={onCancel}
      onConfirm={(v) =>
        onConfirm({
          action: v.action as SecurityMitigation['action'],
          module: (v.module || null) as SecurityModule | null,
          target_user_id: v.target_user_id || null,
          duration_minutes: Math.max(0, Number(v.duration_minutes) || 0),
          reason: v.reason || null,
        })
      }
    />
  )
}
