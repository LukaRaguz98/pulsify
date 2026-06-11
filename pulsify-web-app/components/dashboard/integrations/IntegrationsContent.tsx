'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plug, CheckCircle2, AlertCircle, X, Search, Pause, AlertTriangle, LayoutGrid, ScrollText, Sparkles, PackagePlus, Construction,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import {
  PROVIDERS,
  CATEGORY_META,
  CATEGORY_ORDER,
  computeStats,
  health,
  providerById,
  isConnectable,
  type Integration,
  type IntegrationLog,
  type IntegrationCategory,
  type IntegrationHealth,
} from '@/lib/integrations'
import {
  setIntegrationEnabled,
  disconnectIntegration,
  reconnectIntegration,
  deleteIntegration,
  testConnection,
  type ActionResult,
} from '@/app/dashboard/[guildId]/(management)/integrations/actions'
import { IntegrationCard, ProviderCard } from './IntegrationCard'
import { IntegrationWizard } from './IntegrationWizard'
import { IntegrationLogs } from './IntegrationLogs'

type Channel = { id: string; name: string }
type Feedback = { kind: 'success' | 'error'; msg: string }
type HealthFilter = 'all' | IntegrationHealth
type CategoryFilter = 'all' | IntegrationCategory

type Props = {
  guildId: string
  guildName: string
  initialIntegrations: Integration[]
  initialLogs: IntegrationLog[]
  channels: Channel[]
}

const HEALTH_FILTERS: { key: HealthFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'healthy', label: 'Healthy' },
  { key: 'paused', label: 'Paused' },
  { key: 'error', label: 'Errors' },
  { key: 'disconnected', label: 'Disconnected' },
]

export function IntegrationsContent({
  guildId,
  guildName,
  initialIntegrations,
  initialLogs,
  channels,
}: Props) {
  const router = useRouter()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [search, setSearch] = useState('')
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  // Wizard state: a providerId to connect a new integration, or an Integration to edit.
  const [connecting, setConnecting] = useState<string | null>(null)
  const [editing, setEditing] = useState<Integration | null>(null)
  const [pending, startTransition] = useTransition()

  const channelNames = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels])
  const stats = useMemo(() => computeStats(initialIntegrations), [initialIntegrations])

  // Quick-action deep link (?connect=<providerId>) opens the wizard on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connect = params.get('connect')
    const target = connect ? providerById(connect) : undefined
    if (target && isConnectable(target)) {
      setConnecting(connect)
      params.delete('connect')
      const qs = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    }
  }, [])

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router])

  // Run a per-card action, surface feedback, and refresh. Returns nothing — the
  // card manages its own busy spinner.
  const runAction = useCallback(
    async <T,>(fn: () => Promise<ActionResult<T>>, successMsg: string) => {
      const res = await fn()
      if (res.ok) {
        setFeedback({ kind: 'success', msg: successMsg })
        startTransition(() => router.refresh())
      } else {
        setFeedback({ kind: 'error', msg: res.error })
      }
    },
    [router],
  )

  // ── Connected list: filter by search + health ──
  const q = search.trim().toLowerCase()
  const connected = useMemo(() => {
    return initialIntegrations.filter((i) => {
      if (healthFilter !== 'all' && health(i) !== healthFilter) return false
      if (!q) return true
      const provider = providerById(i.provider)
      return (
        i.label.toLowerCase().includes(q) ||
        i.provider.toLowerCase().includes(q) ||
        (provider?.name.toLowerCase().includes(q) ?? false) ||
        (i.external_ref?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [initialIntegrations, healthFilter, q])

  // ── Available providers: filter by search + category, grouped by category ──
  const connectedByProvider = useMemo(() => {
    const map = new Map<string, number>()
    for (const i of initialIntegrations) {
      if (health(i) === 'healthy' || health(i) === 'paused') {
        map.set(i.provider, (map.get(i.provider) ?? 0) + 1)
      }
    }
    return map
  }, [initialIntegrations])

  const availableGroups = useMemo(() => {
    return CATEGORY_ORDER
      .filter((cat) => categoryFilter === 'all' || categoryFilter === cat)
      .map((cat) => ({
        category: cat,
        providers: PROVIDERS.filter((p) => p.category === cat)
          .filter((p) => {
            if (!q) return true
            return (
              p.name.toLowerCase().includes(q) ||
              p.blurb.toLowerCase().includes(q) ||
              (p.keywords?.toLowerCase().includes(q) ?? false)
            )
          })
          // Connectable providers first; unavailable/planned ones sink to the
          // end of their category (stable, so original order is otherwise kept).
          .sort((a, b) => Number(isConnectable(b)) - Number(isConnectable(a))),
      }))
      .filter((g) => g.providers.length > 0)
  }, [categoryFilter, q])

  const wizardProviderId = connecting ?? editing?.provider ?? null

  return (
    <div className="page-content">
      <PageHeader
        title="Integrations"
        helpId="integrations"
        description={
          <>
            Connect external services to{' '}
            <span className="font-medium text-foreground">{guildName}</span> and pipe their activity into Discord
          </>
        }
        action={
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: stats.connected > 0 ? '#22c55e' : 'var(--text-3)' }} />
              {stats.connected} connected
            </span>
            <RefreshButton onClick={refresh} refreshing={pending} />
          </div>
        }
      />

      {/* Work-in-progress notice — Integrations is an actively-developed surface;
          this sets expectations that more providers and capabilities are planned. */}
      <div
        className="mb-6 flex items-start gap-3 rounded-xl border px-4 py-3.5"
        style={{ borderColor: 'color-mix(in srgb, var(--p-1) 35%, transparent)', background: 'var(--p-soft)' }}
      >
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'color-mix(in srgb, var(--p-1) 16%, transparent)', color: 'var(--p-1)' }}
        >
          <Construction size={16} />
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            Integrations is a work in progress!
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ background: 'color-mix(in srgb, var(--p-1) 18%, transparent)', color: 'var(--p-1)' }}
            >
              In development
            </span>
          </p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
            This surface is actively being expanded — more providers, richer event types and deeper configuration are
            planned. What&apos;s here works today & expect it to keep growing.
          </p>
        </div>
      </div>

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
          icon={<Plug size={14} />}
          title="At a glance"
          description="Health of the services connected to this server."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<CheckCircle2 size={16} />} label="Connected" value={stats.connected} color="#22c55e" />
            <StatCard icon={<Pause size={16} />} label="Paused" value={stats.paused} color="#f59e0b" />
            <StatCard icon={<AlertTriangle size={16} />} label="Need attention" value={stats.errors} color="#ef4444" />
            <StatCard icon={<PackagePlus size={16} />} label="Available" value={stats.available} color="#60a5fa" />
          </div>
        </CategorySection>

        {/* Connected */}
        <CategorySection
          icon={<LayoutGrid size={14} />}
          title="Connected"
          description="Services already wired up to this server. Test, pause, or tweak their settings."
        >
          {initialIntegrations.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border py-16 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                <Plug size={26} />
              </div>
              <p className="font-semibold text-foreground">No integrations connected yet</p>
              <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
                Connect a service below — Pulse will deliver its updates straight into the channel you pick.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 sm:max-w-xs">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search integrations…"
                    className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
                    style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                  />
                </div>
                <div className="inline-flex flex-wrap rounded-lg border p-0.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
                  {HEALTH_FILTERS.map((f) => {
                    const active = healthFilter === f.key
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setHealthFilter(f.key)}
                        className="rounded-md px-3 py-1 text-xs font-medium transition"
                        style={{ background: active ? 'var(--p-soft)' : 'transparent', color: active ? 'var(--p-1)' : 'var(--text-3)' }}
                      >
                        {f.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {connected.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border py-14 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
                    <Search size={22} />
                  </div>
                  <p className="font-semibold text-foreground">No matching integrations</p>
                  <p className="mt-1.5 text-sm" style={{ color: 'var(--text-3)' }}>Try a different search or filter.</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {connected.map((i) => (
                    <IntegrationCard
                      key={i.id}
                      integration={i}
                      channelName={i.channel_id ? channelNames.get(i.channel_id) : undefined}
                      onOpen={() => setEditing(i)}
                      onTest={() =>
                        runAction(
                          () => testConnection(guildId, i.id),
                          'Test sent — check the channel and the logs below.',
                        )
                      }
                      onToggle={() =>
                        runAction(
                          () => setIntegrationEnabled(guildId, i.id, !i.enabled),
                          i.enabled ? 'Notifications paused.' : 'Notifications resumed.',
                        )
                      }
                      onDisconnect={() =>
                        runAction(() => disconnectIntegration(guildId, i.id), 'Integration disconnected.')
                      }
                      onReconnect={() =>
                        runAction(() => reconnectIntegration(guildId, i.id), 'Integration reconnected.')
                      }
                      onDelete={() =>
                        runAction(() => deleteIntegration(guildId, i.id), 'Integration removed.')
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </CategorySection>

        {/* Browse / available */}
        <CategorySection
          icon={<Sparkles size={14} />}
          title="Browse integrations"
          description="Pick a service to connect, grouped by what it does."
        >
          <div className="space-y-5">
            <div className="inline-flex flex-wrap rounded-lg border p-0.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
              {(['all', ...CATEGORY_ORDER] as const).map((f) => {
                const active = categoryFilter === f
                const label = f === 'all' ? 'All' : CATEGORY_META[f].label
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setCategoryFilter(f)}
                    className="rounded-md px-3 py-1 text-xs font-medium transition"
                    style={{ background: active ? 'var(--p-soft)' : 'transparent', color: active ? 'var(--p-1)' : 'var(--text-3)' }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {availableGroups.length === 0 ? (
              <p className="rounded-xl border px-4 py-6 text-center text-sm" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
                No integrations match “{search}”.
              </p>
            ) : (
              availableGroups.map((group) => (
                <section key={group.category}>
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{CATEGORY_META[group.category].label}</h3>
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>{CATEGORY_META[group.category].blurb}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {group.providers.map((p) => (
                      <ProviderCard
                        key={p.id}
                        provider={p}
                        connectedCount={connectedByProvider.get(p.id) ?? 0}
                        onConnect={() => setConnecting(p.id)}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </CategorySection>

        {/* Logs & diagnostics */}
        <CategorySection
          icon={<ScrollText size={14} />}
          title="Activity & logs"
          description="A diagnostic trail of connects, tests, syncs and errors across your integrations."
        >
          <IntegrationLogs logs={initialLogs} integrations={initialIntegrations} channels={channels} />
        </CategorySection>
      </div>

      {wizardProviderId && (
        <IntegrationWizard
          guildId={guildId}
          providerId={wizardProviderId}
          channels={channels}
          editing={editing}
          onFeedback={(kind, msg) => setFeedback({ kind, msg })}
          onClose={() => {
            setConnecting(null)
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
