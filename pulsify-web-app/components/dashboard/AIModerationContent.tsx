'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Sparkles,
  Shield,
  ListChecks,
  ScrollText,
  BarChart3,
  Settings,
  RefreshCw,
  Loader2,
  AlertCircle,
  TrendingUp,
  Activity,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import type { DiscordChannel } from '@/lib/discord'
import { createClient as createSupabase } from '@/lib/supabase'
import type { AIModerationSettings } from '@/lib/ai-moderation'
import type { AIModerationEventRow } from '@/app/api/guilds/[guildId]/ai-moderation/events/route'
import { AIModerationOverview } from '@/components/dashboard/ai-moderation/AIModerationOverview'
import { AIModerationReviewQueue } from '@/components/dashboard/ai-moderation/AIModerationReviewQueue'
import { AIModerationLogs } from '@/components/dashboard/ai-moderation/AIModerationLogs'
import { AIModerationAnalytics } from '@/components/dashboard/ai-moderation/AIModerationAnalytics'

type Tab = 'overview' | 'queue' | 'logs' | 'analytics'

type Props = {
  guildId: string
  channels: DiscordChannel[]
  initialSettings: AIModerationSettings
}

const POLL_INTERVAL = 30_000

export function AIModerationContent({ guildId, channels, initialSettings }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const settings = initialSettings
  const [events, setEvents] = useState<AIModerationEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [secondsAgo, setSecondsAgo] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchEvents = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const res = await fetch(`/api/guilds/${guildId}/ai-moderation/events?limit=500`, {
        cache: 'no-store',
      })
      if (res.ok) {
        const rows: AIModerationEventRow[] = await res.json()
        setEvents(rows)
      }
      setLastUpdated(new Date())
      setSecondsAgo(0)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [guildId])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  useEffect(() => {
    timerRef.current = setInterval(() => fetchEvents(true), POLL_INTERVAL)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [fetchEvents])

  // Live updates: subscribe to new events.
  useEffect(() => {
    const supabase = createSupabase()
    const channel = supabase
      .channel(`ai-moderation:${guildId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_moderation_events',
          filter: `guild_id=eq.${guildId}`,
        },
        () => fetchEvents(true),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [guildId, fetchEvents])

  useEffect(() => {
    const id = setInterval(() => {
      if (lastUpdated) {
        setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  const pending = useMemo(() => events.filter((e) => e.status === 'pending'), [events])
  const resolved = useMemo(() => events.filter((e) => e.status !== 'pending'), [events])

  // Snap the wall-clock reference once per fetch — keeps the memo deterministic
  // for purity-rule lints while still rolling forward whenever the data changes.
  const nowRef = lastUpdated?.getTime() ?? 0
  const summary = useMemo(() => {
    const last24h = events.filter((e) => nowRef - new Date(e.created_at).getTime() < 24 * 3600_000)
    const last7d = events.filter((e) => nowRef - new Date(e.created_at).getTime() < 7 * 24 * 3600_000)
    const autoActions = events.filter((e) => e.status === 'auto_actioned').length
    const topCategoryCounts = new Map<string, number>()
    for (const e of events) {
      if (!e.top_category) continue
      topCategoryCounts.set(e.top_category, (topCategoryCounts.get(e.top_category) ?? 0) + 1)
    }
    return {
      total: events.length,
      last24h: last24h.length,
      last7d: last7d.length,
      pending: pending.length,
      autoActions,
      topCategoryCounts,
    }
  }, [events, pending.length, nowRef])

  const updatedLabel = lastUpdated
    ? secondsAgo < 5 ? 'Just now' : `${secondsAgo}s ago`
    : null

  if (loading) {
    return (
      <div className="page-content">
        <PageHeader
          title="Pulse Guard"
          helpId="pulse-guard"
          description="Detect spam, scams, toxicity, and other harmful content automatically."
        />
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Pulse Guard"
        helpId="pulse-guard"
        description="Detect spam, scams, toxicity, and other harmful content automatically."
        action={
          <div className="flex items-center gap-3">
            <EnabledPill enabled={settings.enabled} />
            {updatedLabel && (
              <span className="text-xs text-subtle">Updated {updatedLabel}</span>
            )}
            <Link
              href={`/dashboard/${guildId}/ai-moderation-settings`}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <Settings size={12} />
              Pulse Guard settings
            </Link>
            <button
              onClick={() => fetchEvents()}
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

      {!settings.enabled && (
        <DisabledBanner guildId={guildId} />
      )}

      <div className="space-y-8">
        <CategorySection
          icon={<TrendingUp size={14} />}
          title="At a glance"
          description="Live Pulse Guard activity for this server."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<Activity size={16} />}
              label="Flagged (24h)"
              value={summary.last24h}
              color="#60a5fa"
            />
            <StatCard
              icon={<ListChecks size={16} />}
              label="Pending review"
              value={summary.pending}
              color="#f59e0b"
            />
            <StatCard
              icon={<Shield size={16} />}
              label="Auto-actions"
              value={summary.autoActions}
              color="#a855f7"
            />
            <StatCard
              icon={<BarChart3 size={16} />}
              label="Total events"
              value={summary.total}
              color="#22c55e"
            />
          </div>
        </CategorySection>

        <CategorySection
          icon={<Sparkles size={14} />}
          title="Workspace"
          description="Configure detectors, review flagged content, and inspect history."
        >
          <div
            className="inline-flex flex-wrap rounded-lg border p-1"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
          >
            <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} icon={<Sparkles size={14} />}>Overview</TabButton>
            <TabButton active={tab === 'queue'} onClick={() => setTab('queue')} icon={<ListChecks size={14} />}>
              Review queue ({pending.length})
            </TabButton>
            <TabButton active={tab === 'logs'} onClick={() => setTab('logs')} icon={<ScrollText size={14} />}>History</TabButton>
            <TabButton active={tab === 'analytics'} onClick={() => setTab('analytics')} icon={<BarChart3 size={14} />}>Analytics</TabButton>
          </div>

          {tab === 'overview' && (
            <AIModerationOverview
              guildId={guildId}
              settings={settings}
              channels={channels}
              recentEvents={events.slice(0, 3)}
              onAnalysisComplete={() => fetchEvents(true)}
            />
          )}
          {tab === 'queue' && (
            <AIModerationReviewQueue
              guildId={guildId}
              events={pending}
              onChange={() => fetchEvents(true)}
            />
          )}
          {tab === 'logs' && (
            <AIModerationLogs events={resolved} />
          )}
          {tab === 'analytics' && (
            <AIModerationAnalytics events={events} summary={summary} />
          )}
        </CategorySection>
      </div>
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
    <div
      className="rounded-xl border p-5"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="flex items-center gap-3 mb-3">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: `${color}1f`, color }}
        >
          {icon}
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p className="text-3xl font-bold text-foreground font-mono">{value.toLocaleString()}</p>
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

function EnabledPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
      style={{
        borderColor: enabled ? 'rgba(34,197,94,0.4)' : 'var(--line-strong)',
        background: enabled ? 'rgba(34,197,94,0.1)' : 'var(--panel)',
        color: enabled ? '#22c55e' : 'var(--text-3)',
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: enabled ? '#22c55e' : 'var(--text-3)' }}
      />
      {enabled ? 'Active' : 'Disabled'}
    </span>
  )
}

function DisabledBanner({ guildId }: { guildId: string }) {
  return (
    <div
      className="mb-6 flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
      style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}
    >
      <div className="flex items-start gap-2">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <span>
          Pulse Guard is currently <span className="font-semibold">disabled</span>. Test analyses still
          run from the dashboard, but automatic actions on live messages are paused until you turn it on.
        </span>
      </div>
      <Link
        href={`/dashboard/${guildId}/ai-moderation-settings`}
        className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border px-2.5 py-1 text-xs font-medium transition"
        style={{ borderColor: 'rgba(245,158,11,0.4)', color: '#f59e0b' }}
      >
        Open settings
      </Link>
    </div>
  )
}

