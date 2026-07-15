'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  BarChart3,
  ClipboardList,
  Fingerprint,
  History,
  Link2,
  ListChecks,
  Loader2,
  Radar,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { createClient as createSupabase } from '@/lib/supabase'
import { defaultAvatarUrl } from '@/lib/discord'
import {
  buildLinkGroups,
  RISK_LEVELS,
  RISK_META,
  STATUS_META,
  type AltAccountSummary,
  type AltDashboardStats,
  type AltInvestigation,
  type AltInvestigationEvent,
  type AltLink,
  type AltLookup,
  type AltRiskLevel,
} from '@/lib/alt-detection'
import { AccountReportView, type Report } from './AccountReport'
import { AccountChip, RiskBadge, StatTile, StatusPill, TimeAgo } from './risk-ui'

type Props = {
  guildId: string
  guildName: string
  stats: AltDashboardStats
  accounts: AltAccountSummary[]
  investigations: AltInvestigation[]
  events: AltInvestigationEvent[]
  links: AltLink[]
  lookups: AltLookup[]
  avatars: Record<string, string>
}

type Tab = 'overview' | 'lookup' | 'investigations' | 'links'

type LookupResult =
  | { ok: true; report: Report; timeline: AltInvestigationEvent[] }
  | { ok: false; error: string }

/** Pull one account report. Kept outside the component so the mount-time
 *  deep-link can call it without touching state until the fetch resolves. */
async function fetchReport(guildId: string, query: string): Promise<LookupResult> {
  try {
    const res = await fetch(
      `/api/discord/guild/${guildId}/alt-detection/lookup?q=${encodeURIComponent(query)}`,
    )
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data.error ?? 'That lookup failed. Try again in a moment.' }
    return { ok: true, report: data.report as Report, timeline: (data.timeline ?? []) as AltInvestigationEvent[] }
  } catch {
    return { ok: false, error: "Couldn't reach Discord. Try again in a moment." }
  }
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <ShieldCheck size={15} /> },
  { id: 'lookup', label: 'Lookup', icon: <Search size={15} /> },
  { id: 'investigations', label: 'Investigations', icon: <ListChecks size={15} /> },
  { id: 'links', label: 'Linked accounts', icon: <Link2 size={15} /> },
]

export function AltDetectionContent({
  guildId,
  guildName,
  stats,
  accounts,
  investigations,
  events,
  links,
  lookups,
  avatars,
}: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  // ?user=<id> deep-link — how the bot's notifications hand an account off to
  // this page. Read during render (not in an effect) so the page opens straight
  // onto the Lookup tab with the query already in the box.
  const deepLinkUser = useSearchParams().get('user') ?? ''

  const [tab, setTab] = useState<Tab>(deepLinkUser ? 'lookup' : 'overview')

  // ── Lookup state ──
  const [query, setQuery] = useState(deepLinkUser)
  const [loading, setLoading] = useState(Boolean(deepLinkUser))
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [timeline, setTimeline] = useState<AltInvestigationEvent[]>([])

  const avatarFor = useCallback(
    (userId: string) => avatars[userId] ?? defaultAvatarUrl(userId),
    [avatars],
  )

  const applyResult = useCallback((result: LookupResult) => {
    if (result.ok) {
      setReport(result.report)
      setTimeline(result.timeline)
      setLookupError(null)
    } else {
      setReport(null)
      setLookupError(result.error)
    }
    setLoading(false)
  }, [])

  const runLookup = useCallback(
    async (raw: string) => {
      const q = raw.trim()
      if (!q) return
      setLoading(true)
      setLookupError(null)
      applyResult(await fetchReport(guildId, q))
    },
    [guildId, applyResult],
  )

  /** Open an account's report from anywhere on the page. */
  const inspect = useCallback(
    (userId: string) => {
      setTab('lookup')
      setQuery(userId)
      void runLookup(userId)
    },
    [runLookup],
  )

  // Resolve the deep-linked account on mount, then drop ?user= from the URL so a
  // refresh doesn't re-run the lookup (and re-record it in the audit trail).
  useEffect(() => {
    if (!deepLinkUser) return
    let cancelled = false
    void fetchReport(guildId, deepLinkUser).then((result) => {
      if (!cancelled) applyResult(result)
    })
    const params = new URLSearchParams(window.location.search)
    params.delete('user')
    const qs = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    return () => {
      cancelled = true
    }
  }, [deepLinkUser, guildId, applyResult])

  // Realtime: the bot auto-flags risky joins, and other moderators work the same
  // queue — keep the page honest without a manual refresh.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const supabase = createSupabase()
    const schedule = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => startTransition(() => router.refresh()), 1200)
    }
    const channel = supabase
      .channel(`alt-detection:${guildId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alt_investigations', filter: `guild_id=eq.${guildId}` }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alt_account_links', filter: `guild_id=eq.${guildId}` }, schedule)
      .subscribe()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [guildId, router])

  // Re-fetch the open report after a write (a status change moves the score's
  // context, and the case file is part of the report).
  const refreshReport = useCallback(() => {
    if (report) void runLookup(report.account.userId)
    startTransition(() => router.refresh())
  }, [report, runLookup, router])

  const openCases = useMemo(
    () => investigations.filter((i) => !STATUS_META[i.status]?.resolved),
    [investigations],
  )
  const resolvedCases = useMemo(
    () => investigations.filter((i) => STATUS_META[i.status]?.resolved),
    [investigations],
  )
  // What Pulse has caught lately, newest first — including cases already dealt
  // with. The queue answers "what's worst"; this answers "what's new".
  const recentDetections = useMemo(
    () =>
      [...investigations].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [investigations],
  )
  const groups = useMemo(() => buildLinkGroups(links), [links])

  return (
    <div className="page-content">
      <PageHeader
        title="Alt Detection"
        helpId="alt-detection"
        description={
          <>
            Score accounts for alt-account indicators and investigate them in{' '}
            <span className="font-medium text-foreground">{guildName}</span>
          </>
        }
        action={
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
            title="Members scored against the risk model"
          >
            <Users size={12} style={{ color: 'var(--text-3)' }} />
            {stats.scanned.toLocaleString()} accounts scored
          </span>
        }
      />

      <div
        className="mb-6 inline-flex flex-wrap rounded-xl border p-1"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        {TABS.map((t) => {
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

      {tab === 'overview' && (
        <OverviewTab
          stats={stats}
          accounts={accounts}
          openCases={openCases}
          recent={recentDetections}
          lookups={lookups}
          avatarFor={avatarFor}
          onInspect={inspect}
        />
      )}

      {tab === 'lookup' && (
        <LookupTab
          guildId={guildId}
          query={query}
          setQuery={setQuery}
          loading={loading}
          error={lookupError}
          report={report}
          timeline={timeline}
          onSearch={() => void runLookup(query)}
          onClear={() => {
            setQuery('')
            setReport(null)
            setLookupError(null)
          }}
          onChanged={refreshReport}
        />
      )}

      {tab === 'investigations' && (
        <InvestigationsTab
          openCases={openCases}
          resolvedCases={resolvedCases}
          events={events}
          avatarFor={avatarFor}
          onInspect={inspect}
        />
      )}

      {tab === 'links' && (
        <LinksTab groups={groups} avatarFor={avatarFor} onInspect={inspect} />
      )}
    </div>
  )
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab({
  stats,
  accounts,
  openCases,
  recent,
  lookups,
  avatarFor,
  onInspect,
}: {
  stats: AltDashboardStats
  accounts: AltAccountSummary[]
  openCases: AltInvestigation[]
  recent: AltInvestigation[]
  lookups: AltLookup[]
  avatarFor: (id: string) => string
  onInspect: (userId: string) => void
}) {
  const [level, setLevel] = useState<AltRiskLevel | 'all'>('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return accounts.filter((a) => {
      if (level !== 'all' && a.level !== level) return false
      if (!needle) return true
      return (
        a.username.toLowerCase().includes(needle) ||
        a.displayName.toLowerCase().includes(needle) ||
        a.userId.includes(needle)
      )
    })
  }, [accounts, level, search])

  return (
    <div className="space-y-8">
      <CategorySection icon={<ShieldCheck size={14} />} title="At a glance" description="What needs attention across the server right now.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={<AlertTriangle size={16} />}
            label="Need a look"
            value={stats.actionable}
            accent={RISK_META.high.color}
            hint="High + Critical"
          />
          <StatTile
            icon={<ListChecks size={16} />}
            label="Open investigations"
            value={stats.openCases}
            accent="#60a5fa"
          />
          <StatTile
            icon={<Link2 size={16} />}
            label="Linked account groups"
            value={stats.linkedGroups}
            accent="#a78bfa"
          />
          <StatTile
            icon={<ShieldCheck size={16} />}
            label="Resolved"
            value={stats.resolvedCases}
            accent={RISK_META.low.color}
          />
        </div>
      </CategorySection>

      {/* Band distribution — the shape of the server, at a glance. */}
      <CategorySection icon={<BarChart3 size={14} />} title="Risk distribution" description="How members fall across the risk bands. Click a band to filter the list below.">
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex h-3 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
          {RISK_LEVELS.map((l) => {
            const pct = stats.scanned > 0 ? (stats.byLevel[l] / stats.scanned) * 100 : 0
            if (pct === 0) return null
            return (
              <div
                key={l}
                style={{ width: `${pct}%`, background: RISK_META[l].color }}
                title={`${RISK_META[l].label}: ${stats.byLevel[l]}`}
              />
            )
          })}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {RISK_LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLevel((cur) => (cur === l ? 'all' : l))}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors"
              style={{
                borderColor: level === l ? RISK_META[l].color : 'var(--line)',
                background: level === l ? RISK_META[l].tint : 'transparent',
              }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: RISK_META[l].color }} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{stats.byLevel[l].toLocaleString()}</span>
                <span className="block text-xs text-subtle">{RISK_META[l].label}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      </CategorySection>

      {/* Highest risk accounts */}
      <CategorySection
        icon={<AlertTriangle size={14} style={{ color: RISK_META.high.color }} />}
        title="Highest risk accounts"
        description="Members with the strongest alt-account signals — open one to see the full report."
        action={
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-3)' }}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name or ID"
              className="w-52 rounded-lg border py-1.5 pl-8 pr-3 text-xs outline-none transition-colors focus:border-[var(--p-1)]"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          </div>
        }
      >
        {accounts.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={26} />}
            title="Nothing above Low risk"
            description="Every member Pulse can see reads as an established account. New joins are scored automatically as they arrive."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search size={20} />}
            title="No accounts match"
            description="Try a different name, ID or risk band."
            variant="muted"
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((account) => (
              <button
                key={account.userId}
                type="button"
                onClick={() => onInspect(account.userId)}
                className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-[var(--p-1)]"
                style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
              >
                <AccountChip
                  avatar={avatarFor(account.userId)}
                  name={account.displayName}
                  subtitle={account.signals.join(' · ') || `@${account.username}`}
                />
                <span className="ml-auto hidden text-xs text-subtle sm:block">
                  <TimeAgo iso={account.joinedAt} prefix="joined" />
                </span>
                <RiskBadge level={account.level} score={account.score} />
              </button>
            ))}
          </div>
        )}
      </CategorySection>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Investigation queue */}
        <CategorySection icon={<ListChecks size={14} />} title="Investigation queue" description="Open cases waiting on your team.">
          {openCases.length === 0 ? (
            <EmptyState
              icon={<ClipboardList size={20} />}
              title="Queue is clear"
              description="No open investigations. Pulse opens one automatically when a high-risk account joins."
              variant="muted"
            />
          ) : (
            <div className="space-y-2">
              {openCases.slice(0, 8).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onInspect(c.user_id)}
                  className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-[var(--p-1)]"
                  style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
                >
                  <AccountChip
                    avatar={avatarFor(c.user_id)}
                    name={c.user_name ?? c.user_id}
                    subtitle={c.source === 'auto' ? 'Flagged automatically on join' : `Opened by ${c.opened_by_name ?? 'a moderator'}`}
                    size={32}
                  />
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    <StatusPill status={c.status} size="sm" />
                    <RiskBadge level={c.risk_level} score={c.risk_score} size="sm" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </CategorySection>

        {/* Recently detected — what Pulse has caught lately, newest first. */}
        <CategorySection icon={<Radar size={14} />} title="Recently detected" description="High and critical accounts, newest first.">
          {recent.length === 0 ? (
            <EmptyState
              icon={<Radar size={20} />}
              title="Nothing detected yet"
              description="Pulse scores every account as it joins. High and critical ones land here the moment they arrive."
              variant="muted"
            />
          ) : (
            <div className="space-y-2">
              {recent.slice(0, 8).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onInspect(c.user_id)}
                  className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-[var(--p-1)]"
                  style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
                >
                  <AccountChip
                    avatar={avatarFor(c.user_id)}
                    name={c.user_name ?? c.user_id}
                    subtitle={(c.signals ?? []).slice(0, 2).join(' · ') || 'Flagged for review'}
                    size={32}
                  />
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    <span className="hidden text-xs text-subtle sm:block">
                      <TimeAgo iso={c.created_at} />
                    </span>
                    <RiskBadge level={c.risk_level} score={c.risk_score} size="sm" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </CategorySection>
      </div>

      {/* Lookup history — the audit trail: who checked whom, and from where. */}
      <CategorySection icon={<History size={14} />} title="Recent lookups" description="Who checked whom — here or with /alt-check.">
        {lookups.length === 0 ? (
          <EmptyState
            icon={<Search size={20} />}
            title="No lookups yet"
            description="Every account report a moderator opens — here or with /alt-check — is recorded."
            variant="muted"
          />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {lookups.slice(0, 10).map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onInspect(l.user_id)}
                className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-[var(--p-1)]"
                style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
              >
                <AccountChip
                  avatar={avatarFor(l.user_id)}
                  name={l.user_name ?? l.user_id}
                  subtitle={`${l.actor_name ?? 'A moderator'} · ${l.source === 'command' ? '/alt-check' : 'dashboard'}`}
                  size={32}
                />
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <span className="hidden text-xs text-subtle sm:block">
                    <TimeAgo iso={l.created_at} />
                  </span>
                  <RiskBadge level={l.risk_level} score={l.risk_score} size="sm" />
                </span>
              </button>
            ))}
          </div>
        )}
      </CategorySection>
    </div>
  )
}

// ── Lookup ───────────────────────────────────────────────────────────────────

function LookupTab({
  guildId,
  query,
  setQuery,
  loading,
  error,
  report,
  timeline,
  onSearch,
  onClear,
  onChanged,
}: {
  guildId: string
  query: string
  setQuery: (v: string) => void
  loading: boolean
  error: string | null
  report: Report | null
  timeline: AltInvestigationEvent[]
  onSearch: () => void
  onClear: () => void
  onChanged: () => void
}) {
  return (
    <div className="space-y-6">
      <CategorySection icon={<Fingerprint size={14} />} title="Account lookup" description="Score any member against every alt-account signal Pulse can see.">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSearch()
        }}
        className="flex flex-wrap gap-2"
      >
        <div className="relative min-w-0 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-3)' }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a member — username, @mention or Discord ID"
            className="w-full rounded-lg border py-2.5 pl-9 pr-9 text-sm outline-none transition-colors focus:border-[var(--p-1)]"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
          {query && (
            <button
              type="button"
              onClick={onClear}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-subtle transition-colors hover:text-foreground"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
          style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Fingerprint size={15} />}
          Check account
        </button>
      </form>
      </CategorySection>

      {error && (
        <div
          className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
          style={{ background: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.4)', color: '#f87171' }}
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !report && <TableSkeleton rows={5} columns={3} />}

      {!loading && !report && !error && (
        <EmptyState
          icon={<Fingerprint size={26} />}
          title="Look up an account"
          description="Search any member by username, mention or Discord ID. Pulse scores them against every signal it has and shows the accounts that may be related."
        />
      )}

      {report && (
        <AccountReportView guildId={guildId} report={report} timeline={timeline} onChanged={onChanged} />
      )}
    </div>
  )
}

// ── Investigations ───────────────────────────────────────────────────────────

function InvestigationsTab({
  openCases,
  resolvedCases,
  events,
  avatarFor,
  onInspect,
}: {
  openCases: AltInvestigation[]
  resolvedCases: AltInvestigation[]
  events: AltInvestigationEvent[]
  avatarFor: (id: string) => string
  onInspect: (userId: string) => void
}) {
  const [search, setSearch] = useState('')
  const match = (c: AltInvestigation) => {
    const needle = search.trim().toLowerCase()
    if (!needle) return true
    return (c.user_name ?? '').toLowerCase().includes(needle) || c.user_id.includes(needle)
  }

  const open = openCases.filter(match)
  const resolved = resolvedCases.filter(match)

  return (
    <div className="space-y-8">
      <CategorySection
        icon={<ListChecks size={14} />}
        title={`Open (${open.length})`}
        description="Cases your team is actively working."
        action={
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-3)' }}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter cases"
              className="w-52 rounded-lg border py-1.5 pl-8 pr-3 text-xs outline-none transition-colors focus:border-[var(--p-1)]"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          </div>
        }
      >
        {open.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={20} />}
            title="No open investigations"
            description="Open one from an account's report, or wait for Pulse to flag a high-risk join."
            variant="muted"
          />
        ) : (
          <div className="space-y-2">
            {open.map((c) => (
              <CaseRow key={c.id} investigation={c} avatar={avatarFor(c.user_id)} onInspect={onInspect} />
            ))}
          </div>
        )}
      </CategorySection>

      <CategorySection icon={<ShieldCheck size={14} style={{ color: RISK_META.low.color }} />} title={`Resolved (${resolved.length})`} description="Cleared, confirmed or banned — the closed cases.">
        {resolved.length === 0 ? (
          <p className="text-sm text-subtle">No cases have been closed yet.</p>
        ) : (
          <div className="space-y-2">
            {resolved.map((c) => (
              <CaseRow key={c.id} investigation={c} avatar={avatarFor(c.user_id)} onInspect={onInspect} resolved />
            ))}
          </div>
        )}
      </CategorySection>

      <CategorySection icon={<History size={14} />} title="Activity" description="Notes, status changes and links as your team works the queue.">
        {events.length === 0 ? (
          <p className="text-sm text-subtle">
            Notes, status changes and links show up here as your team works the queue.
          </p>
        ) : (
          <div className="space-y-2">
            {events.slice(0, 25).map((e) => (
              <div
                key={e.id}
                className="flex items-start gap-3 rounded-lg border px-3 py-2.5"
                style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
              >
                <span className="mt-0.5 shrink-0" style={{ color: 'var(--text-3)' }}>
                  {e.kind === 'note' ? <ClipboardList size={14} /> : e.kind === 'link' || e.kind === 'unlink' ? <Link2 size={14} /> : <AlertTriangle size={14} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{e.body ?? e.kind}</p>
                  <p className="text-xs text-subtle">
                    {e.author_name ?? 'Pulse'} · <TimeAgo iso={e.created_at} />
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onInspect(e.user_id)}
                  className="shrink-0 text-xs font-medium transition-colors hover:text-foreground"
                  style={{ color: 'var(--p-1)' }}
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        )}
      </CategorySection>
    </div>
  )
}

function CaseRow({
  investigation,
  avatar,
  onInspect,
  resolved,
}: {
  investigation: AltInvestigation
  avatar: string
  onInspect: (userId: string) => void
  resolved?: boolean
}) {
  const c = investigation
  return (
    <button
      type="button"
      onClick={() => onInspect(c.user_id)}
      className="flex w-full flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-[var(--p-1)]"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <AccountChip
        avatar={avatar}
        name={c.user_name ?? c.user_id}
        subtitle={
          resolved && c.resolution
            ? c.resolution
            : c.source === 'auto'
              ? 'Flagged automatically on join'
              : `Opened by ${c.opened_by_name ?? 'a moderator'}`
        }
      />
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <span className="hidden text-xs text-subtle sm:block">
          <TimeAgo iso={resolved ? c.resolved_at : c.created_at} />
        </span>
        <StatusPill status={c.status} size="sm" />
        <RiskBadge level={c.risk_level} score={c.risk_score} size="sm" />
      </span>
    </button>
  )
}

// ── Linked accounts ──────────────────────────────────────────────────────────

function LinksTab({
  groups,
  avatarFor,
  onInspect,
}: {
  groups: ReturnType<typeof buildLinkGroups>
  avatarFor: (id: string) => string
  onInspect: (userId: string) => void
}) {
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<Link2 size={26} />}
        title="No linked accounts yet"
        description="When you link two accounts from a lookup, the group shows up here — including any third account either of them is linked to."
      />
    )
  }

  return (
    <CategorySection
      icon={<Link2 size={14} />}
      title="Linked account groups"
      description="Accounts a moderator marked as related. Accounts linked indirectly (A to B, B to C) are collected into one group."
    >
      {groups.map((group) => (
        <section
          key={group.members.map((m) => m.userId).join('-')}
          className="rounded-xl border p-4"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Link2 size={14} style={{ color: 'var(--p-1)' }} />
              {group.members.length} linked accounts
            </h3>
            <span className="text-xs text-subtle">
              {group.links.length} link{group.links.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.members.map((m) => (
              <button
                key={m.userId}
                type="button"
                onClick={() => onInspect(m.userId)}
                className="flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:border-[var(--p-1)]"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line)' }}
              >
                <AccountChip avatar={avatarFor(m.userId)} name={m.userName ?? m.userId} subtitle={m.userId} size={30} />
              </button>
            ))}
          </div>
          {group.links.some((l) => l.note) && (
            <ul className="mt-3 space-y-1 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
              {group.links
                .filter((l) => l.note)
                .map((l) => (
                  <li key={l.id} className="text-xs text-subtle">
                    {l.created_by_name ?? 'A moderator'}: {l.note}
                  </li>
                ))}
            </ul>
          )}
        </section>
      ))}
    </CategorySection>
  )
}
