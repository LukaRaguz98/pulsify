'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Users,
  Activity,
  UserPlus,
  ShieldCheck,
  ShieldAlert,
  Search,
  Loader2,
  AlertCircle,
  Bot,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { CategorySection } from '@/components/ui/category-section'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { Pagination } from '@/components/ui/pagination'
import { SortableHeader, nextSort, type SortDirection } from '@/components/ui/sortable-header'
import { createClient as createSupabase } from '@/lib/supabase'
import { avatarUrl, roleColor, type DiscordMember } from '@/lib/discord'
import { formatDuration } from '@/lib/analytics'
import { memberReputation, memberRisk } from '@/lib/member-metrics'
import type { Reputation, RiskAssessment } from '@/lib/reputation'
import type { DirectoryMember, DirectoryResponse } from '@/lib/member-profile'
import { ReputationBadge, RiskBadge, LevelBadge } from '@/components/dashboard/members/badges'

// Body-only — the PageHeader + Directory/Leaderboard tabs live in MembersContent.
type Props = { guildId: string }

type FilterKey = 'all' | 'active' | 'inactive' | 'at_risk' | 'new' | 'staff' | 'bots'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'at_risk', label: 'At risk' },
  { key: 'new', label: 'New' },
  { key: 'staff', label: 'Staff' },
  { key: 'bots', label: 'Bots' },
]

const ACTIVE_WINDOW_MS = 30 * 86_400_000
const NEW_WINDOW_MS = 7 * 86_400_000
const RISK_RANK = { none: 0, low: 1, medium: 2, high: 3 } as const

type Row = {
  dm: DirectoryMember
  reputation: Reputation
  risk: RiskAssessment
  displayName: string
  isActive: boolean
  isNew: boolean
}

function memberDisplayName(m: DiscordMember): string {
  return m.nick ?? m.user.global_name ?? m.user.username
}

// Date.now() lives inside these module-level helpers (not the render body) so
// the react-hooks purity rule stays happy — same pattern the moderation tabs use.
function isRecentlyActive(iso: string | null): boolean {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() < ACTIVE_WINDOW_MS
}

function isNewJoin(joinedAt: string): boolean {
  return Date.now() - new Date(joinedAt).getTime() < NEW_WINDOW_MS
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'Just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

export function MembersDirectory({ guildId }: Props) {
  const router = useRouter()
  const [data, setData] = useState<DirectoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [roleFilter, setRoleFilter] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: SortDirection }>({ key: 'reputation', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const initialised = useRef(false)

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/discord/guild/${guildId}/members/directory?limit=1000`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Request failed (${res.status})`)
        }
        setData((await res.json()) as DirectoryResponse)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load members.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [guildId],
  )

  useEffect(() => {
    if (initialised.current) return
    initialised.current = true
    load()
  }, [load])

  // Live updates: a warning/ban/role change or member join-leave refreshes the
  // directory quickly; high-volume message/voice activity (which nudges
  // reputation) is refreshed on a longer debounce so we don't refetch the whole
  // roster on every message.
  useEffect(() => {
    const supabase = createSupabase()
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        load(true)
      }, delay)
    }
    const channel = supabase
      .channel(`members-directory:${guildId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'moderation_logs', filter: `guild_id=eq.${guildId}` }, () => schedule(1000))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guild_warnings', filter: `guild_id=eq.${guildId}` }, () => schedule(1000))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'analytics_events', filter: `guild_id=eq.${guildId}` }, (payload) => {
        const evt = payload.new as { event_type?: string }
        // Joins/leaves change the roster, so reflect them promptly; ordinary
        // message/command activity only nudges reputation, so debounce hard.
        schedule(evt.event_type === 'member_join' || evt.event_type === 'member_leave' ? 1500 : 15000)
      })
      // XP changes (level/xp columns) are high-volume — debounce hard like activity.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_levels', filter: `guild_id=eq.${guildId}` }, () => schedule(15000))
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [guildId, load])

  const sortedRoles = useMemo(
    () =>
      (data?.roles ?? [])
        .filter((r) => r.name !== '@everyone' && !r.managed)
        .sort((a, b) => b.position - a.position),
    [data],
  )

  // Reputation + risk are independent of the filters, so compute them once per
  // data load and reuse across re-filters.
  const rows = useMemo<Row[]>(() => {
    if (!data) return []
    return data.members.map((dm) => ({
      dm,
      reputation: memberReputation(dm.member, data.roles, dm.activity, dm.infractions),
      risk: memberRisk(dm.infractions),
      displayName: memberDisplayName(dm.member),
      isActive: isRecentlyActive(dm.activity.last_active),
      isNew: isNewJoin(dm.member.joined_at),
    }))
  }, [data])

  const counts = useMemo(() => {
    let active = 0
    let staff = 0
    let atRisk = 0
    let newMembers = 0
    for (const r of rows) {
      if (r.isActive) active++
      if (r.dm.isStaff) staff++
      if (r.risk.level === 'high' || r.risk.level === 'medium') atRisk++
      if (r.isNew) newMembers++
    }
    return { total: rows.length, active, staff, atRisk, newMembers }
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = rows.filter((r) => {
      const m = r.dm.member
      switch (filter) {
        case 'active':
          if (!r.isActive) return false
          break
        case 'inactive':
          if (r.isActive || m.user.bot) return false
          break
        case 'at_risk':
          if (r.risk.level !== 'high' && r.risk.level !== 'medium') return false
          break
        case 'new':
          if (!r.isNew) return false
          break
        case 'staff':
          if (!r.dm.isStaff) return false
          break
        case 'bots':
          if (!m.user.bot) return false
          break
      }
      if (roleFilter && !m.roles.includes(roleFilter)) return false
      if (!q) return true
      return (
        r.displayName.toLowerCase().includes(q) ||
        m.user.username.toLowerCase().includes(q) ||
        m.user.id.includes(q)
      )
    })

    const dirMul = sort.dir === 'asc' ? 1 : -1
    matches.sort((a, b) => {
      let cmp = 0
      switch (sort.key) {
        case 'name':
          cmp = a.displayName.localeCompare(b.displayName)
          break
        case 'reputation':
          cmp = a.reputation.score - b.reputation.score
          break
        case 'level':
          cmp = (a.dm.level?.level ?? 0) - (b.dm.level?.level ?? 0)
          if (cmp === 0) cmp = (a.dm.level?.xp ?? 0) - (b.dm.level?.xp ?? 0)
          break
        case 'xp':
          cmp = (a.dm.level?.xp ?? 0) - (b.dm.level?.xp ?? 0)
          break
        case 'messages':
          cmp = a.dm.activity.message_count - b.dm.activity.message_count
          break
        case 'voice':
          cmp = a.dm.activity.voice_seconds - b.dm.activity.voice_seconds
          break
        case 'joined':
          cmp = new Date(a.dm.member.joined_at).getTime() - new Date(b.dm.member.joined_at).getTime()
          break
        case 'risk':
          cmp = RISK_RANK[a.risk.level] - RISK_RANK[b.risk.level]
          if (cmp === 0) cmp = b.dm.infractions.total_infractions - a.dm.infractions.total_infractions
          break
      }
      if (cmp === 0) cmp = b.reputation.score - a.reputation.score
      return cmp * dirMul
    })
    return matches
  }, [rows, search, filter, roleFilter, sort])

  const paged = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const safePage = Math.min(Math.max(1, page), totalPages)
    const start = (safePage - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  function handleSort(key: string) {
    setSort((prev) => nextSort(prev, key, 'desc'))
    setPage(1)
  }

  function goToProfile(userId: string) {
    router.push(`/dashboard/${guildId}/members/${userId}`)
  }

  if (loading) {
    return (
      <div>
        <div className="mb-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[116px]" />
          ))}
        </div>
        <TableSkeleton rows={8} columns={5} />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div
        className="flex items-center gap-3 rounded-xl border p-5"
        style={{ background: 'var(--panel)', borderColor: 'rgba(239,68,68,0.35)' }}
      >
        <AlertCircle size={18} style={{ color: '#f87171' }} />
        <p className="text-sm text-muted-foreground">{error ?? 'Members are unavailable right now.'}</p>
      </div>
    )
  }

  const fetchedAll =
    data.approximateMemberCount === null || data.members.length >= data.approximateMemberCount

  return (
    <div>
      <div className="space-y-8">
        <CategorySection
          icon={<Users size={14} />}
          title="At a glance"
          description="Reputation, activity and risk across your membership."
        >
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatsCard label="Members" value={counts.total} sub={fetchedAll ? 'In this server' : `of ~${data.approximateMemberCount?.toLocaleString()}`} icon={<Users size={16} />} accent="var(--p-1)" />
            <StatsCard label="Active" value={counts.active} sub="Active in last 30 days" icon={<Activity size={16} />} accent="var(--green)" />
            <StatsCard label="New" value={counts.newMembers} sub="Joined in last 7 days" icon={<UserPlus size={16} />} accent="var(--cyan)" />
            <StatsCard label="Staff" value={counts.staff} sub="Hold a moderation role" icon={<ShieldCheck size={16} />} accent="#8b5cf6" />
            <StatsCard label="Flagged" value={counts.atRisk} sub="Medium or high risk" icon={<ShieldAlert size={16} />} accent="var(--red)" />
          </div>
        </CategorySection>

        <CategorySection
          icon={<Search size={14} />}
          title="Directory"
          description="Search and filter members, then open a profile for full insights."
        >
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-[360px]">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setPage(1)
                  }}
                  placeholder="Search by name, username or ID…"
                  className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                />
              </div>
              <select
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value)
                  setPage(1)
                }}
                className="min-w-[150px] rounded-lg border px-2.5 py-2 pr-8 text-xs focus:outline-none focus:ring-1"
                style={{
                  background: 'var(--bg-2)',
                  borderColor: roleFilter ? 'var(--p-1)' : 'var(--line-strong)',
                  color: roleFilter ? 'var(--p-1)' : 'var(--text-2)',
                }}
                title="Filter by role"
              >
                <option value="">All roles</option>
                {sortedRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex flex-wrap items-center gap-1 rounded-lg border p-1" style={{ borderColor: 'var(--line-strong)' }}>
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => {
                      setFilter(f.key)
                      setPage(1)
                    }}
                    className="rounded-md px-2.5 py-1 text-xs font-medium transition"
                    style={{
                      background: filter === f.key ? 'var(--p-soft)' : 'transparent',
                      color: filter === f.key ? 'var(--p-1)' : 'var(--text-3)',
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <RefreshButton onClick={() => load(true)} refreshing={refreshing} />
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              variant="muted"
              icon={<Search size={24} />}
              title="No members match"
              description={search ? `No members matching "${search}".` : 'No members in this view.'}
            />
          ) : (
            <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--line-strong)' }}>
              <table className="w-full min-w-[860px] text-sm table-stack">
                <thead>
                  <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                    <th className="text-left"><SortableHeader label="Member" columnKey="name" activeKey={sort.key} direction={sort.dir} onSort={handleSort} /></th>
                    <th className="text-left"><SortableHeader label="Level" columnKey="level" activeKey={sort.key} direction={sort.dir} onSort={handleSort} /></th>
                    <th className="text-left"><SortableHeader label="XP" columnKey="xp" activeKey={sort.key} direction={sort.dir} onSort={handleSort} /></th>
                    <th className="text-left"><SortableHeader label="Reputation" columnKey="reputation" activeKey={sort.key} direction={sort.dir} onSort={handleSort} /></th>
                    <th className="text-left"><SortableHeader label="Messages" columnKey="messages" activeKey={sort.key} direction={sort.dir} onSort={handleSort} /></th>
                    <th className="text-left"><SortableHeader label="Voice" columnKey="voice" activeKey={sort.key} direction={sort.dir} onSort={handleSort} /></th>
                    <th className="text-left"><SortableHeader label="Joined" columnKey="joined" activeKey={sort.key} direction={sort.dir} onSort={handleSort} /></th>
                    <th className="text-left"><SortableHeader label="Risk" columnKey="risk" activeKey={sort.key} direction={sort.dir} onSort={handleSort} /></th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => {
                    const m = r.dm.member
                    const av = avatarUrl(m.user.id, m.user.avatar)
                    const memberRoles = sortedRoles.filter((role) => m.roles.includes(role.id)).slice(0, 2)
                    return (
                      <tr
                        key={m.user.id}
                        onClick={() => goToProfile(m.user.id)}
                        className="cursor-pointer border-b transition-colors"
                        style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--panel) 50%, transparent)' }}
                      >
                        <td className="px-4 py-3" data-label="">
                          <div className="flex items-center gap-3">
                            <Image src={av} alt={r.displayName} width={30} height={30} className="rounded-full shrink-0" unoptimized />
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 truncate text-foreground">
                                {r.displayName}
                                {m.user.bot && <Bot size={12} className="shrink-0 text-subtle" />}
                                {r.dm.isStaff && <ShieldCheck size={12} className="shrink-0" style={{ color: 'var(--p-1)' }} />}
                              </p>
                              <div className="mt-0.5 flex items-center gap-1.5">
                                <span className="truncate text-xs text-subtle">@{m.user.username}</span>
                                {memberRoles.map((role) => (
                                  <span key={role.id} className="inline-flex items-center gap-1 rounded px-1 text-[10px]" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>
                                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: roleColor(role.color) }} />
                                    {role.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3" data-label="Level"><LevelBadge level={r.dm.level?.level ?? 0} size="sm" /></td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground" data-label="XP">{(r.dm.level?.xp ?? 0).toLocaleString()}</td>
                        <td className="px-4 py-3" data-label="Reputation"><ReputationBadge reputation={r.reputation} size="sm" /></td>
                        <td className="px-4 py-3" data-label="Messages">
                          <span className="font-mono text-xs text-foreground">{r.dm.activity.message_count.toLocaleString()}</span>
                          <span className="ml-1 text-[10px] text-subtle">· {relativeTime(r.dm.activity.last_active)}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground" data-label="Voice">{formatDuration(r.dm.activity.voice_seconds)}</td>
                        <td className="px-4 py-3 text-xs text-subtle" data-label="Joined">
                          {new Date(m.joined_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-3" data-label="Risk"><RiskBadge risk={r.risk} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={filtered.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
              />
            </div>
          )}
        </CategorySection>
      </div>

      {refreshing && (
        <div className="mt-4 flex items-center gap-2 text-xs text-subtle">
          <Loader2 size={12} className="animate-spin" />
          Updating…
        </div>
      )}
    </div>
  )
}
