'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Trophy, Sparkles, Zap, Activity, AlertCircle, Users, BarChart3, Globe, Server, Coins } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { CategorySection } from '@/components/ui/category-section'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { createClient as createSupabase } from '@/lib/supabase'
import { formatDuration } from '@/lib/analytics'
import { formatCoins } from '@/lib/economy'
import { reputationFromScore } from '@/lib/reputation'
import type { LeaderboardEntry, LeaderboardResponse, RichestEntry } from '@/lib/member-profile'
import { LevelBadge, ReputationBadge } from '@/components/dashboard/members/badges'
import { RankBadge } from '@/components/dashboard/RankBadge'

type Props = {
  guildId: string
  /** Whether rows are clickable through to a profile. */
  linkToProfiles?: boolean
  /** Which profile route a row opens: `members` = admin detail (default),
   *  `profile` = the read-only member-facing profile. */
  profileBasePath?: 'members' | 'profile'
}

// UI board id: the data boards (level/reputation/active) plus "richest", the
// global wallet ranking sourced from the economy. ("Server XP" was folded into
// "Server level" — that board already shows XP next to the level.)
type BoardId = 'level' | 'reputation' | 'active' | 'richest'

// Each board is explicitly scoped: level/activity are SERVER metrics, while
// reputation and richest are GLOBAL — shared across every Pulse server.
const BOARDS: {
  key: BoardId
  label: string
  icon: React.ReactNode
  scope: 'server' | 'global'
}[] = [
  { key: 'level', label: 'Server level', icon: <Sparkles size={15} />, scope: 'server' },
  { key: 'reputation', label: 'Global reputation', icon: <Globe size={15} />, scope: 'global' },
  { key: 'active', label: 'Most active', icon: <Activity size={15} />, scope: 'server' },
  { key: 'richest', label: 'Richest', icon: <Coins size={15} />, scope: 'global' },
]

const WINDOWS: { key: string; label: string }[] = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'all', label: 'All time' },
]

// The metric column the active board ranks by — accented in the header so the
// table makes the ranking dimension obvious (the order is server-driven, so
// these headers aren't sortable like the Members directory's).
const BOARD_PRIMARY: Record<BoardId, string> = {
  level: 'level',
  reputation: 'reputation',
  active: 'messages',
  richest: '',
}

// Member-board columns — the same dimensions the Members directory surfaces, so
// the two tables read identically.
const MEMBER_COLS: { key: string; label: string }[] = [
  { key: 'level', label: 'Level' },
  { key: 'xp', label: 'XP' },
  { key: 'reputation', label: 'Reputation' },
  { key: 'messages', label: 'Messages' },
  { key: 'voice', label: 'Voice' },
]

function headerCellStyle(active: boolean): React.CSSProperties {
  return active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }
}

// Fixed width for the leading rank ("#") column. Pinning it to the same value in
// every board table means the Member column always starts at the same x-position
// — so it never shifts when you switch between boards.
const RANK_COL_WIDTH = 64
const RANK_HEADER_STYLE: React.CSSProperties = { width: RANK_COL_WIDTH, color: 'var(--text-3)' }
const RANK_CELL_STYLE: React.CSSProperties = { width: RANK_COL_WIDTH }

/**
 * Member boards (level / reputation / most-active) rendered in the same table
 * chrome as the Members directory: bordered container, stacked header, hover
 * rows that open the member's profile.
 */
function MemberBoardTable({
  entries,
  board,
  linkToProfiles,
  onOpen,
}: {
  entries: LeaderboardEntry[]
  board: BoardId
  linkToProfiles: boolean
  onOpen: (userId: string) => void
}) {
  const primary = BOARD_PRIMARY[board]
  return (
    <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--line-strong)' }}>
      <table className="w-full min-w-[760px] text-sm table-stack">
        <thead>
          <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <th className="px-4 py-3 text-left text-xs font-medium" style={RANK_HEADER_STYLE}>#</th>
            <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Member</th>
            {MEMBER_COLS.map((c) => (
              <th key={c.key} className="px-4 py-3 text-left text-xs font-medium" style={headerCellStyle(c.key === primary)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => {
            const interactive = linkToProfiles
            return (
              <tr
                key={e.userId}
                onClick={interactive ? () => onOpen(e.userId) : undefined}
                className={`border-b transition-colors${interactive ? ' cursor-pointer' : ''}`}
                style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}
                onMouseEnter={interactive ? (ev) => { ev.currentTarget.style.background = 'var(--bg-2)' } : undefined}
                onMouseLeave={interactive ? (ev) => { ev.currentTarget.style.background = 'color-mix(in srgb, var(--panel) 50%, transparent)' } : undefined}
              >
                <td className="px-4 py-3" data-label="" style={RANK_CELL_STYLE}><RankBadge rank={i + 1} /></td>
                <td className="px-4 py-3" data-label="">
                  <div className="flex items-center gap-3">
                    <Image src={e.avatar} alt={e.name} width={30} height={30} unoptimized className="rounded-full shrink-0" />
                    <p className="truncate font-medium text-foreground">{e.name}</p>
                  </div>
                </td>
                <td className="px-4 py-3" data-label="Level"><LevelBadge level={e.level} size="sm" /></td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground" data-label="XP">{e.xp.toLocaleString()}</td>
                <td className="px-4 py-3" data-label="Reputation"><ReputationBadge reputation={reputationFromScore(e.reputation)} size="sm" /></td>
                <td className="px-4 py-3 font-mono text-xs text-foreground" data-label="Messages">{e.messages.toLocaleString()}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground" data-label="Voice">{e.voiceSeconds > 0 ? formatDuration(e.voiceSeconds) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * "Richest" board — global Pulse Coin wallets ranked by balance. Rendered in the
 * same table chrome as the member boards, now with a profile icon (the holder's
 * guild avatar when they're a member here, otherwise the Discord default). These
 * are GLOBAL wallets, so rows aren't clickable through to a server profile.
 */
function RichestTable({ rows }: { rows: RichestEntry[] }) {
  return (
    <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--line-strong)' }}>
      <table className="w-full min-w-[520px] text-sm table-stack">
        <thead>
          <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <th className="px-4 py-3 text-left text-xs font-medium" style={RANK_HEADER_STYLE}>#</th>
            <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Member</th>
            <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Earned all-time</th>
            <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--p-1)' }}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u, i) => (
            <tr
              key={u.user_id}
              className="border-b"
              style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}
            >
              <td className="px-4 py-3" data-label="" style={RANK_CELL_STYLE}><RankBadge rank={i + 1} /></td>
              <td className="px-4 py-3" data-label="">
                <div className="flex items-center gap-3">
                  <Image src={u.avatar} alt={u.user_name ?? u.user_id} width={30} height={30} unoptimized className="rounded-full shrink-0" />
                  <p className="truncate font-medium text-foreground">{u.user_name ?? u.user_id}</p>
                </div>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground" data-label="Earned all-time">{formatCoins(u.lifetime_earned)}</td>
              <td className="px-4 py-3 font-mono text-sm font-bold text-foreground" data-label="Balance">{formatCoins(u.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MembersLeaderboard({ guildId, linkToProfiles = true, profileBasePath = 'members' }: Props) {
  const router = useRouter()
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [board, setBoard] = useState<BoardId>('level')
  const [window, setWindow] = useState('30d')

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/discord/guild/${guildId}/members/leaderboard?window=${window}`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Request failed (${res.status})`)
        }
        setData((await res.json()) as LeaderboardResponse)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load the leaderboard.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [guildId, window],
  )

  useEffect(() => {
    load()
  }, [load])

  // Live updates: refetch (debounced) when XP changes anywhere in the guild.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const supabase = createSupabase()
    const channel = supabase
      .channel(`members-leaderboard:${guildId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_levels', filter: `guild_id=eq.${guildId}` }, () => {
        if (debounce.current) clearTimeout(debounce.current)
        debounce.current = setTimeout(() => load(true), 8000)
      })
      .subscribe()
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
      supabase.removeChannel(channel)
    }
  }, [guildId, load])

  if (loading) {
    return (
      <div>
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[112px]" />
          ))}
        </div>
        <Skeleton className="h-[480px]" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-3 rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'rgba(239,68,68,0.35)' }}>
        <AlertCircle size={18} style={{ color: '#f87171' }} />
        <p className="text-sm text-muted-foreground">{error ?? 'The leaderboard is unavailable right now.'}</p>
      </div>
    )
  }

  const entries = board === 'richest' ? [] : data.boards[board]
  const maxDist = Math.max(1, ...data.distribution.map((d) => d.count))

  return (
    <div className="space-y-8">
      {/* Analytics */}
      <CategorySection icon={<BarChart3 size={14} />} title="Engagement" description="XP and level analytics for this server's membership (server-specific progression).">
        <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard label="Members tracked" value={data.totals.tracked} sub="Have earned XP here" icon={<Users size={16} />} accent="var(--p-1)" />
          <StatsCard label="Total XP" value={data.totals.totalXp.toLocaleString()} sub="Earned in this server" icon={<Zap size={16} />} accent="var(--cyan)" />
          <StatsCard label="Average level" value={data.totals.avgLevel} sub="Across tracked members" icon={<Sparkles size={16} />} accent="var(--amber)" />
          <StatsCard label="Top level" value={data.totals.topLevel} sub="Highest reached here" icon={<Trophy size={16} />} accent="var(--green)" />
        </div>

        <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <p className="mb-4 text-sm font-medium text-foreground">Level distribution</p>
          {data.totals.tracked === 0 ? (
            <p className="text-sm text-subtle">No members have earned XP yet.</p>
          ) : (
            <div className="grid grid-cols-10 items-end gap-1.5" style={{ height: 120 }}>
              {data.distribution.map((d) => (
                <div key={d.label} className="flex h-full flex-col items-center justify-end gap-1">
                  <span className="text-[9px] font-mono text-subtle">{d.count}</span>
                  <div
                    className="xp-bar w-full rounded-t"
                    style={{ height: `${Math.max(2, (d.count / maxDist) * 92)}%`, background: 'var(--p-1)' }}
                  />
                  <span className="text-[9px] leading-none text-subtle">{d.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CategorySection>

      {/* Leaderboard */}
      <CategorySection icon={<Trophy size={14} />} title="Leaderboard" description="Rank members by server progression (level & XP), global reputation, recent activity and Pulse Coin wealth.">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex flex-wrap rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            {BOARDS.map((b) => {
              const active = board === b.key
              return (
                <button
                  key={b.key}
                  onClick={() => setBoard(b.key)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                  style={active ? { background: 'var(--p-soft)', color: 'var(--text)' } : { color: 'var(--text-2)' }}
                >
                  <span style={active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{b.icon}</span>
                  {b.label}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--line-strong)' }}>
              {WINDOWS.map((w) => {
                const active = window === w.key
                return (
                  <button
                    key={w.key}
                    onClick={() => setWindow(w.key)}
                    className="rounded-md px-2.5 py-1 text-xs font-medium transition"
                    style={{ background: active ? 'var(--p-soft)' : 'transparent', color: active ? 'var(--p-1)' : 'var(--text-3)' }}
                    title={board === 'active' ? 'Filters the activity window' : 'Only affects the “Most active” board'}
                  >
                    {w.label}
                  </button>
                )
              })}
            </div>
            <RefreshButton onClick={() => load(true)} refreshing={refreshing} />
          </div>
        </div>

        {/* Scope line: spell out global vs server so the two never blur. */}
        <p className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-subtle">
          {board === 'reputation' ? (
            <>
              <Globe size={12} style={{ color: 'var(--p-1)' }} />
              <span className="font-medium text-muted-foreground">Global metric</span>
              — the 0–100 trust score each member carries across every server running Pulse.
            </>
          ) : board === 'richest' ? (
            <>
              <Globe size={12} style={{ color: 'var(--p-1)' }} />
              <span className="font-medium text-muted-foreground">Global metric</span>
              — Pulse Coin balances ranked across every server running Pulse.
            </>
          ) : (
            <>
              <Server size={12} style={{ color: 'var(--p-1)' }} />
              <span className="font-medium text-muted-foreground">Server metric</span>
              — {board === 'active' ? 'activity tracked in this server only.' : 'XP and levels are earned in this server only.'}
            </>
          )}
          {board !== 'active' && (
            <span>Totals are all-time — the timeframe only filters the “Most active” board.</span>
          )}
        </p>

        {board === 'richest' ? (
          data.richest.length === 0 ? (
            <EmptyState
              icon={<Coins size={36} />}
              title="No wallets yet"
              description="Members start earning Pulse Coins the moment they're active in any server running Pulse."
            />
          ) : (
            <RichestTable rows={data.richest} />
          )
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<Trophy size={36} />}
            title="Nothing to rank yet"
            description={board === 'active' ? 'No tracked activity in this timeframe.' : 'No members have earned XP yet — activity will populate the board.'}
          />
        ) : (
          <MemberBoardTable
            entries={entries}
            board={board}
            linkToProfiles={linkToProfiles}
            onOpen={(userId) => router.push(`/dashboard/${guildId}/${profileBasePath}/${userId}`)}
          />
        )}
      </CategorySection>
    </div>
  )
}
