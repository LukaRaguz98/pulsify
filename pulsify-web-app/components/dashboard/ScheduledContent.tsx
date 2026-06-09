'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  ListChecks,
  LayoutTemplate,
  BarChart3,
  ScrollText,
  RefreshCw,
  AlertTriangle,
  Power,
  PauseCircle,
  Zap,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { DiscordChannel, DiscordRole } from '@/lib/discord'
import { createClient as createSupabase } from '@/lib/supabase'
import type { Timeframe } from '@/lib/analytics'
import type { Automation, AutomationDraft } from '@/lib/automations'
import type { AutomationRunRow } from '@/app/api/guilds/[guildId]/automations/logs/route'
import type { AutomationAnalytics as AutomationAnalyticsData } from '@/app/api/guilds/[guildId]/automations/analytics/route'
import {
  toggleAutomation,
  deleteAutomation,
  runAutomationNow,
} from '@/app/dashboard/[guildId]/scheduled/actions'
import { AutomationList } from '@/components/dashboard/scheduled/AutomationList'
import { AutomationEditPanel } from '@/components/dashboard/scheduled/AutomationEditPanel'
import { AutomationTemplates } from '@/components/dashboard/scheduled/AutomationTemplates'
import { AutomationLogs } from '@/components/dashboard/scheduled/AutomationLogs'
import { AutomationAnalytics } from '@/components/dashboard/scheduled/AutomationAnalytics'

type Tab = 'workflows' | 'templates' | 'logs' | 'analytics'

type Props = {
  guildId: string
  guildName: string
  channels: DiscordChannel[]
  roles: DiscordRole[]
  initialAutomations: Automation[]
}

// Editor state: closed, creating (optionally seeded from a template), or editing.
type Editor =
  | { mode: 'closed' }
  | { mode: 'create'; seed: AutomationDraft | null }
  | { mode: 'edit'; automation: Automation }

export function ScheduledContent({ guildId, channels, roles, initialAutomations }: Props) {
  const [tab, setTab] = useState<Tab>('workflows')
  const [automations, setAutomations] = useState<Automation[]>(initialAutomations)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor>({ mode: 'closed' })
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [logs, setLogs] = useState<AutomationRunRow[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [analytics, setAnalytics] = useState<AutomationAnalyticsData | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [timeframe, setTimeframe] = useState<Timeframe>('7d')
  const [refreshing, setRefreshing] = useState(false)

  const counts = useMemo(() => {
    let active = 0
    let paused = 0
    let failing = 0
    for (const a of automations) {
      if (a.enabled) active++
      else paused++
      if (a.enabled && a.last_status === 'failed') failing++
    }
    return { total: automations.length, active, paused, failing }
  }, [automations])

  // ── Data fetching ───────────────────────────────────────────────────────────
  const supabase = useMemo(() => createSupabase(), [])

  const fetchAutomations = useCallback(async () => {
    const { data } = await supabase
      .from('scheduled_automations')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
    if (data) setAutomations(data as Automation[])
  }, [supabase, guildId])

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const res = await fetch(`/api/guilds/${guildId}/automations/logs?limit=300`, { cache: 'no-store' })
      if (res.ok) setLogs(await res.json())
    } finally {
      setLogsLoading(false)
    }
  }, [guildId])

  const fetchAnalytics = useCallback(
    async (tf: Timeframe) => {
      setAnalyticsLoading(true)
      try {
        const res = await fetch(`/api/guilds/${guildId}/automations/analytics?timeframe=${tf}`, { cache: 'no-store' })
        if (res.ok) setAnalytics(await res.json())
      } finally {
        setAnalyticsLoading(false)
      }
    },
    [guildId],
  )

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  useEffect(() => {
    fetchAnalytics(timeframe)
  }, [fetchAnalytics, timeframe])

  // Live updates: definition changes refresh the workflow list; new runs refresh
  // the log + analytics (and the list, so run/fail counts + status stay current).
  useEffect(() => {
    const channel = supabase
      .channel(`scheduled:${guildId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scheduled_automations', filter: `guild_id=eq.${guildId}` },
        () => fetchAutomations(),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'automation_runs', filter: `guild_id=eq.${guildId}` },
        () => {
          fetchLogs()
          fetchAnalytics(timeframe)
          fetchAutomations()
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, guildId, fetchAutomations, fetchLogs, fetchAnalytics, timeframe])

  async function refreshAll() {
    setRefreshing(true)
    await Promise.all([fetchAutomations(), fetchLogs(), fetchAnalytics(timeframe)])
    setRefreshing(false)
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  function setBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function handleToggle(a: Automation, enabled: boolean) {
    setActionError(null)
    setAutomations((list) => list.map((x) => (x.id === a.id ? { ...x, enabled } : x)))
    setBusy(a.id, true)
    const res = await toggleAutomation(guildId, a.id, enabled)
    setBusy(a.id, false)
    if (!res.ok) {
      setAutomations((list) => list.map((x) => (x.id === a.id ? { ...x, enabled: !enabled } : x)))
      setActionError(res.error)
    } else {
      fetchAutomations()
    }
  }

  async function handleRunNow(a: Automation) {
    setActionError(null)
    setBusy(a.id, true)
    const res = await runAutomationNow(guildId, a.id)
    setBusy(a.id, false)
    if (!res.ok) setActionError(res.error)
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    const res = await deleteAutomation(guildId, pendingDelete.id)
    setDeleting(false)
    if (!res.ok) {
      setActionError(res.error)
    } else {
      setAutomations((list) => list.filter((x) => x.id !== pendingDelete.id))
    }
    setPendingDelete(null)
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Scheduled"
        helpId="scheduled"
        description="Build recurring workflows — announcements, role sync, channel locks, reports and more — that Pulse runs on a schedule."
        action={
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: counts.active > 0 ? '#22c55e' : 'var(--text-3)' }} />
              {counts.active}/{counts.total} active
            </span>
            <button
              onClick={refreshAll}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        }
      />

      {actionError && (
        <div
          className="mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      <div className="space-y-8">
        <CategorySection
          icon={<CalendarClock size={14} />}
          title="At a glance"
          description="The state of your scheduled automation in this server."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Zap size={16} />} label="Workflows" value={counts.total} color="#60a5fa" />
            <StatCard icon={<Power size={16} />} label="Active" value={counts.active} color="#22c55e" />
            <StatCard icon={<PauseCircle size={16} />} label="Paused" value={counts.paused} color="#94a3b8" />
            <StatCard icon={<XCircle size={16} />} label="Failing" value={counts.failing} color="#f87171" />
          </div>
        </CategorySection>

        <CategorySection
          icon={<CalendarClock size={14} />}
          title="Workspace"
          description="Manage workflows, start from a template, review runs and analytics."
        >
          <div
            className="inline-flex flex-wrap rounded-lg border p-1"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
          >
            <TabButton active={tab === 'workflows'} onClick={() => setTab('workflows')} icon={<ListChecks size={14} />}>Workflows</TabButton>
            <TabButton active={tab === 'templates'} onClick={() => setTab('templates')} icon={<LayoutTemplate size={14} />}>Templates</TabButton>
            <TabButton active={tab === 'logs'} onClick={() => setTab('logs')} icon={<ScrollText size={14} />}>Logs</TabButton>
            <TabButton active={tab === 'analytics'} onClick={() => setTab('analytics')} icon={<BarChart3 size={14} />}>Analytics</TabButton>
          </div>

          {tab === 'workflows' && (
            <AutomationList
              automations={automations}
              busyIds={busyIds}
              onCreate={() => setEditor({ mode: 'create', seed: null })}
              onEdit={(a) => setEditor({ mode: 'edit', automation: a })}
              onToggle={handleToggle}
              onRunNow={handleRunNow}
              onDelete={(a) => setPendingDelete(a)}
            />
          )}
          {tab === 'templates' && (
            <AutomationTemplates
              onUseTemplate={(seed) => {
                setEditor({ mode: 'create', seed })
                setTab('workflows')
              }}
            />
          )}
          {tab === 'logs' && <AutomationLogs logs={logs} loading={logsLoading} />}
          {tab === 'analytics' && (
            <AutomationAnalytics
              data={analytics}
              loading={analyticsLoading}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
            />
          )}
        </CategorySection>
      </div>

      {editor.mode !== 'closed' && (
        <AutomationEditPanel
          guildId={guildId}
          channels={channels}
          roles={roles}
          automation={editor.mode === 'edit' ? editor.automation : null}
          seed={editor.mode === 'create' ? editor.seed : null}
          onClose={() => setEditor({ mode: 'closed' })}
          onSaved={fetchAutomations}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.name}"?`}
          description="This permanently removes the workflow. Its run history is kept in the logs. This can't be undone."
          confirmLabel="Delete workflow"
          tone="destructive"
          busy={deleting}
          onCancel={() => !deleting && setPendingDelete(null)}
          onConfirm={confirmDelete}
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

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition"
      style={{ background: active ? 'var(--p-soft)' : 'transparent', color: active ? 'var(--p-1)' : 'var(--text-3)' }}
    >
      {icon}
      {children}
    </button>
  )
}
