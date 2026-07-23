'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  TerminalSquare,
  ListChecks,
  BarChart3,
  ScrollText,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Wrench,
  Lock,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import type { DiscordChannel, DiscordRole } from '@/lib/discord'
import { createClient as createSupabase } from '@/lib/supabase'
import {
  catalogByName,
  defaultConfig,
  defaultConfigFor,
  commandStatus,
  hasRestrictions,
  type CommandConfig,
  type CommandDefinition,
} from '@/lib/commands'
import type { Timeframe } from '@/lib/analytics'
import type { CommandAnalytics as CommandAnalyticsData } from '@/app/api/guilds/[guildId]/commands/analytics/route'
import type { CommandLogRow } from '@/app/api/guilds/[guildId]/commands/logs/route'
import { saveCommandConfig, bulkSetCommandsEnabled } from '@/app/dashboard/[guildId]/(management)/commands/actions'
import { CommandList, type ResolvedCommand } from '@/components/dashboard/commands/CommandList'
import { CommandEditPanel } from '@/components/dashboard/commands/CommandEditPanel'
import { CommandAnalytics } from '@/components/dashboard/commands/CommandAnalytics'
import { CommandLogs } from '@/components/dashboard/commands/CommandLogs'

type Tab = 'commands' | 'analytics' | 'logs'

type Props = {
  guildId: string
  /**
   * The catalog as published by the running bot (`command_catalog`). Empty when
   * the bot has never synced — rendered as an empty state rather than an
   * invented list.
   */
  catalog: CommandDefinition[]
  channels: DiscordChannel[]
  roles: DiscordRole[]
  initialConfigs: Record<string, CommandConfig>
}

export function CommandsContent({ guildId, catalog, channels, roles, initialConfigs }: Props) {
  const [tab, setTab] = useState<Tab>('commands')
  const [configs, setConfigs] = useState<Record<string, CommandConfig>>(initialConfigs)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [busyNames, setBusyNames] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)

  const [usageByName, setUsageByName] = useState<Record<string, number>>({})
  const [analytics, setAnalytics] = useState<CommandAnalyticsData | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [timeframe, setTimeframe] = useState<Timeframe>('7d')
  const [logs, setLogs] = useState<CommandLogRow[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const byName = useMemo(() => catalogByName(catalog), [catalog])

  const configFor = useCallback(
    (name: string): CommandConfig => {
      const def = byName[name]
      return configs[name] ?? (def ? defaultConfigFor(def) : defaultConfig())
    },
    [configs, byName],
  )

  const resolved: ResolvedCommand[] = useMemo(
    () => catalog.map((def) => ({ def, config: configs[def.name] ?? defaultConfigFor(def) })),
    [configs, catalog],
  )

  const counts = useMemo(() => {
    let enabled = 0
    let disabled = 0
    let maintenance = 0
    let restricted = 0
    for (const { config } of resolved) {
      const st = commandStatus(config)
      if (st === 'enabled') enabled++
      else if (st === 'disabled') disabled++
      else maintenance++
      if (hasRestrictions(config)) restricted++
    }
    return { total: resolved.length, enabled, disabled, maintenance, restricted }
  }, [resolved])

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch(`/api/guilds/${guildId}/commands/analytics?timeframe=all`, {
        cache: 'no-store',
      })
      if (res.ok) {
        const data: CommandAnalyticsData = await res.json()
        const map: Record<string, number> = {}
        for (const s of data.stats) map[s.command_name] = s.total
        setUsageByName(map)
      }
    } catch {
      /* leave previous counts */
    }
  }, [guildId])

  const fetchAnalytics = useCallback(
    async (tf: Timeframe) => {
      setAnalyticsLoading(true)
      try {
        const res = await fetch(`/api/guilds/${guildId}/commands/analytics?timeframe=${tf}`, {
          cache: 'no-store',
        })
        if (res.ok) setAnalytics(await res.json())
      } finally {
        setAnalyticsLoading(false)
      }
    },
    [guildId],
  )

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const res = await fetch(`/api/guilds/${guildId}/commands/logs?limit=300`, {
        cache: 'no-store',
      })
      if (res.ok) setLogs(await res.json())
    } finally {
      setLogsLoading(false)
    }
  }, [guildId])

  useEffect(() => {
    fetchUsage()
    fetchLogs()
  }, [fetchUsage, fetchLogs])

  useEffect(() => {
    fetchAnalytics(timeframe)
  }, [fetchAnalytics, timeframe])

  // Live updates: any new command_log refreshes the log + usage views.
  useEffect(() => {
    const supabase = createSupabase()
    const channel = supabase
      .channel(`command-logs:${guildId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'command_logs', filter: `guild_id=eq.${guildId}` },
        () => {
          fetchLogs()
          fetchUsage()
          fetchAnalytics(timeframe)
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [guildId, fetchLogs, fetchUsage, fetchAnalytics, timeframe])

  async function refreshAll() {
    setRefreshing(true)
    await Promise.all([fetchUsage(), fetchLogs(), fetchAnalytics(timeframe)])
    setRefreshing(false)
  }

  // ── Mutations ────────────────────────────────────────────────────────────
  function setBusy(names: string[], busy: boolean) {
    setBusyNames((prev) => {
      const next = new Set(prev)
      for (const n of names) {
        if (busy) next.add(n)
        else next.delete(n)
      }
      return next
    })
  }

  async function toggleEnabled(name: string, enabled: boolean) {
    if (!byName[name]) return
    setActionError(null)
    const prev = configFor(name)
    const next = { ...prev, enabled }
    setConfigs((c) => ({ ...c, [name]: next }))
    setBusy([name], true)
    const res = await saveCommandConfig(guildId, name, next)
    setBusy([name], false)
    if (!res.ok) {
      setConfigs((c) => ({ ...c, [name]: prev })) // revert
      setActionError(res.error)
    }
  }

  async function bulkSetEnabled(names: string[], enabled: boolean) {
    setActionError(null)
    const snapshot = { ...configs }
    setConfigs((c) => {
      const next = { ...c }
      for (const n of names) next[n] = { ...configFor(n), enabled }
      return next
    })
    setBusy(names, true)
    const res = await bulkSetCommandsEnabled(guildId, names, enabled)
    setBusy(names, false)
    if (!res.ok) {
      setConfigs(snapshot) // revert
      setActionError(res.error)
    }
  }

  function onPanelSaved(name: string, config: CommandConfig) {
    setConfigs((c) => ({ ...c, [name]: config }))
  }

  const selectedDef = selectedName ? byName[selectedName] : null

  // The catalog is published by the bot on startup (PULSIFY-61). An empty one
  // means Pulse has never booted against this database, so there are no
  // registered commands to configure — the stats, tabs and analytics would all
  // be zeroes over an invented list. Say what's actually wrong instead.
  if (catalog.length === 0) {
    return (
      <div className="page-content">
        <PageHeader
          title="Command Center"
          helpId="commands"
          description="Manage Pulse's slash commands, permissions, limits and usage for this server."
        />
        <EmptyState
          icon={<TerminalSquare size={22} />}
          title="No commands published yet"
          description="Pulse publishes its command list when it starts up. Once the bot has connected, every command it offers appears here, ready to configure."
        />
      </div>
    )
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Command Center"
        helpId="commands"
        description="Manage Pulse's slash commands, permissions, limits and usage for this server."
        action={
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#22c55e' }} />
              {counts.enabled}/{counts.total} enabled
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
          icon={<TerminalSquare size={14} />}
          title="At a glance"
          description="The state of Pulse's command surface in this server."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<CheckCircle2 size={16} />} label="Enabled" value={counts.enabled} color="#22c55e" />
            <StatCard icon={<CircleSlash size={16} />} label="Disabled" value={counts.disabled} color="#94a3b8" />
            <StatCard icon={<Wrench size={16} />} label="Maintenance" value={counts.maintenance} color="#f59e0b" />
            <StatCard icon={<Lock size={16} />} label="Restricted" value={counts.restricted} color="#a855f7" />
          </div>
        </CategorySection>

        <CategorySection
          icon={<TerminalSquare size={14} />}
          title="Workspace"
          description="Browse commands, review analytics, and inspect the execution log."
        >
          <div
            className="inline-flex flex-wrap rounded-lg border p-1"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
          >
            <TabButton active={tab === 'commands'} onClick={() => setTab('commands')} icon={<ListChecks size={14} />}>
              Commands
            </TabButton>
            <TabButton active={tab === 'analytics'} onClick={() => setTab('analytics')} icon={<BarChart3 size={14} />}>
              Analytics
            </TabButton>
            <TabButton active={tab === 'logs'} onClick={() => setTab('logs')} icon={<ScrollText size={14} />}>
              Logs
            </TabButton>
          </div>

          {tab === 'commands' && (
            <CommandList
              commands={resolved}
              usageByName={usageByName}
              busyNames={busyNames}
              onSelect={setSelectedName}
              onToggleEnabled={toggleEnabled}
              onBulkSetEnabled={bulkSetEnabled}
            />
          )}
          {tab === 'analytics' && (
            <CommandAnalytics
              catalog={catalog}
              data={analytics}
              loading={analyticsLoading}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
            />
          )}
          {tab === 'logs' && <CommandLogs logs={logs} loading={logsLoading} />}
        </CategorySection>
      </div>

      {selectedDef && (
        <CommandEditPanel
          guildId={guildId}
          definition={selectedDef}
          config={configFor(selectedDef.name)}
          roles={roles}
          channels={channels}
          onClose={() => setSelectedName(null)}
          onSaved={onPanelSaved}
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
