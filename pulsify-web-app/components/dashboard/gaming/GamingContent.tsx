'use client'

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertCircle,
  BarChart3,
  Download,
  Gamepad2,
  Settings,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { TimeframeFilter } from '@/components/dashboard/TimeframeFilter'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { LeaderboardLink } from '@/components/dashboard/LeaderboardLink'
import { TabButton } from '@/components/dashboard/gaming/gaming-style'
import { GamingOverview } from '@/components/dashboard/gaming/GamingOverview'
import { GamingGames } from '@/components/dashboard/gaming/GamingGames'
import { GamingLive } from '@/components/dashboard/gaming/GamingLive'
import { GamingTrends } from '@/components/dashboard/gaming/GamingTrends'
import { GamingSquads } from '@/components/dashboard/gaming/GamingSquads'
import type { Timeframe } from '@/lib/analytics'
import type { Plan } from '@/lib/billing'
import type {
  CommunityInsights,
  DailyPoint,
  GameStat,
  GameTrend,
  GamingOverview as Overview,
  HeatmapCell,
  PeakActivity,
  PlayerStat,
} from '@/lib/gaming'

/**
 * Analytics › Gaming (PULSIFY-64).
 *
 * One fetch drives five of the six tabs — the analytics payload is computed for
 * a single window and every view is a projection of it, so switching tabs is
 * instant and every number on screen was computed against the same "now". Live
 * activity and squad detection fetch separately: one polls, the other is the
 * module's expensive query.
 */

// No "Players" tab: it was a ranking, and every ranking now lives on the
// Leaderboards page (Members › Leaderboard → "Gaming"). The per-member gaming
// profile it used to open survives on the overview's "Top players" widget.
const TABS = [
  { key: 'overview', label: 'Overview', icon: <BarChart3 size={15} /> },
  { key: 'games', label: 'Games', icon: <Gamepad2 size={15} /> },
  { key: 'live', label: 'Live', icon: <Activity size={15} /> },
  { key: 'trends', label: 'Trends', icon: <TrendingUp size={15} /> },
  { key: 'squads', label: 'Squads', icon: <Trophy size={15} /> },
] as const

type Tab = (typeof TABS)[number]['key']

export type GamingPayload = {
  enabled: boolean
  anonymise: boolean
  /** Whether the derived views (trends, heatmaps, squads, exports) are unlocked. */
  advanced: boolean
  requiredPlan: Plan | null
  window: {
    timeframe: Timeframe
    /** null for an unbounded 'all time' window. */
    days: number | null
    since: string | null
    boundBy: 'plan' | 'settings' | 'timeframe' | 'none'
    planRetentionDays: number
    periodLabel: string
    timezone: string
  }
  overview: Overview
  games: GameStat[]
  players: PlayerStat[]
  daily: DailyPoint[]
  heatmap: HeatmapCell[]
  trends: GameTrend[]
  insights: CommunityInsights
  peaks: PeakActivity
  newGames: GameStat[]
}

/**
 * The `?tab=` deep link, read as an external store.
 *
 * `selectTab` updates the URL with `history.replaceState` rather than a router
 * navigation, so `useSearchParams` would never see the change and reading it in
 * an effect would be a cascading render. There is nothing to subscribe to —
 * replaceState fires no event — so this is a one-shot read whose server
 * snapshot is empty, letting SSR render the default tab and the client correct
 * it during hydration.
 */
const NO_SUBSCRIBE = () => () => {}

function useDeepLinkedTab(): Tab {
  const search = useSyncExternalStore(
    NO_SUBSCRIBE,
    () => window.location.search,
    () => '',
  )
  const t = new URLSearchParams(search).get('tab')
  return TABS.some((x) => x.key === t) ? (t as Tab) : 'overview'
}

export function GamingContent({ guildId }: { guildId: string }) {
  const initialTab = useDeepLinkedTab()
  const [chosenTab, setTab] = useState<Tab | null>(null)
  const tab = chosenTab ?? initialTab
  const [timeframe, setTimeframe] = useState<Timeframe>('30d')
  const [data, setData] = useState<GamingPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The browser's own zone, so "busiest hour" means the hour the person reading
  // the chart lives in rather than whatever UTC happened to record.
  const tz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  }, [])

  // Bumping this re-runs the fetch effect. The Refresh button and the window
  // selector are event handlers, so they may set state freely; the effect
  // itself only ever calls setState after an await, which is what keeps it out
  // of the cascading-render trap the project's lint rules guard against.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/guilds/${guildId}/gaming?timeframe=${timeframe}&tz=${encodeURIComponent(tz)}`,
          { cache: 'no-store' },
        )
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(body.error ?? 'Gaming analytics could not be loaded.')
        setData(body as GamingPayload)
        setError(null)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Gaming analytics could not be loaded.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [guildId, timeframe, tz, reloadKey])

  const reload = useCallback(() => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }, [])

  function selectTab(next: Tab) {
    setTab(next)
    const params = new URLSearchParams(window.location.search)
    if (next === 'overview') params.delete('tab')
    else params.set('tab', next)
    const qs = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
  }

  const settingsHref = `/dashboard/${guildId}/gaming-settings`

  return (
    <div className="page-content">
      <PageHeader
        title="Gaming"
        helpId="gaming"
        description="What this server plays, for how long, and with whom — measured from Discord presence."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <TimeframeFilter value={timeframe} onChange={setTimeframe} disabled={loading} />
            <RefreshButton onClick={reload} refreshing={loading} />
            <ExportMenu guildId={guildId} timeframe={timeframe} tz={tz} />
            <LeaderboardLink guildId={guildId} board="gaming" label="Gaming leaderboard" />
            <Link
              href={settingsHref}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
            >
              <Settings size={12} />
              Gaming settings
            </Link>
          </div>
        }
      />

      <div
        className="mb-6 flex flex-wrap gap-1 rounded-xl border p-1"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        {TABS.map((t) => (
          <TabButton
            key={t.key}
            active={tab === t.key}
            icon={t.icon}
            label={t.label}
            onClick={() => selectTab(t.key)}
          />
        ))}
      </div>

      {data && !data.enabled && (
        <div
          className="mb-6 flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          style={{
            borderColor: 'rgba(245,158,11,0.35)',
            background: 'rgba(245,158,11,0.08)',
            color: '#f59e0b',
          }}
        >
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              Gaming tracking is <span className="font-semibold">off</span>. Nothing is being
              recorded — existing history stays, but no new sessions are added.
            </span>
          </div>
          <Link href={settingsHref} className="shrink-0 font-semibold underline">
            Turn it on
          </Link>
        </div>
      )}

      {data && data.enabled && data.window.boundBy === 'plan' && (
        <div
          className="mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-3)' }}
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            Showing the last {data.window.days} days — your plan keeps{' '}
            {data.window.planRetentionDays} days of analytics history. Nothing is deleted;
            upgrading brings the older sessions straight back.
          </span>
        </div>
      )}

      {error && (
        <EmptyState
          icon={<AlertCircle size={18} />}
          title="Couldn't load gaming analytics"
          description={error}
          variant="muted"
          action={
            <button
              type="button"
              onClick={() => reload()}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold"
              style={{ background: 'var(--p-1)', color: '#fff' }}
            >
              Try again
            </button>
          }
        />
      )}

      {!error && (
        <>
          {tab === 'overview' && (
            <GamingOverview data={data} loading={loading} guildId={guildId} tz={tz} />
          )}
          {tab === 'games' && <GamingGames data={data} loading={loading} guildId={guildId} tz={tz} />}
          {tab === 'live' && <GamingLive guildId={guildId} />}
          {tab === 'trends' && <GamingTrends data={data} loading={loading} />}
          {tab === 'squads' && (
            <GamingSquads
              guildId={guildId}
              timeframe={timeframe}
              locked={data ? !data.advanced : false}
              requiredPlan={data?.requiredPlan ?? null}
            />
          )}
        </>
      )}
    </div>
  )
}

/**
 * Export menu. Every combination of dataset × format the API supports, because
 * "export the leaderboards as PDF" and "export the raw history as CSV" are
 * genuinely different jobs and picking for the admin would be guessing.
 */
function ExportMenu({
  guildId,
  timeframe,
  tz,
}: {
  guildId: string
  timeframe: Timeframe
  tz: string
}) {
  const [open, setOpen] = useState(false)

  const datasets = [
    { key: 'players', label: 'Player statistics' },
    { key: 'games', label: 'Game statistics' },
    { key: 'leaderboards', label: 'Leaderboards' },
    { key: 'sessions', label: 'Complete history' },
  ] as const

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
        style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
      >
        <Download size={12} />
        Export
      </button>
      {open && (
        <>
          {/* Click-away layer — a menu that only closes via its own button is a
              trap on touch devices. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute right-0 z-50 mt-1.5 w-60 rounded-xl border p-1.5 shadow-lg"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            {datasets.map((d) => (
              <div key={d.key} className="px-1.5 py-1">
                <p
                  className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--text-3)' }}
                >
                  {d.label}
                </p>
                <div className="flex gap-1">
                  {(['csv', 'json', 'pdf'] as const).map((f) => (
                    <a
                      key={f}
                      href={`/api/guilds/${guildId}/gaming/export?dataset=${d.key}&format=${f}&timeframe=${timeframe}&tz=${encodeURIComponent(tz)}`}
                      onClick={() => setOpen(false)}
                      className="flex-1 rounded-md px-2 py-1 text-center text-xs font-medium transition-colors"
                      style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                    >
                      {f.toUpperCase()}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
