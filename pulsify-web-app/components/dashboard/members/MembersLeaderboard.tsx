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
import { formatCoins, type EconomyUser } from '@/lib/economy'
import type { LeaderboardEntry, LeaderboardKey, LeaderboardResponse } from '@/lib/member-profile'
import { LevelBadge } from '@/components/dashboard/members/badges'
import { RankBadge } from '@/components/dashboard/RankBadge'

type Props = {
  guildId: string
  /** Row click opens the admin member profile — disable for the read-only
   *  member experience (members can't open other members' profiles). */
  linkToProfiles?: boolean
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

// Primary + secondary metric shown per board. The sub-line always names the
// metric's scope so global reputation can't be misread as a server stat.
function metric(board: LeaderboardKey, e: LeaderboardEntry): { value: string; sub: string } {
  switch (board) {
    case 'level':
      return { value: `Lvl ${e.level}`, sub: `${e.xp.toLocaleString()} XP · this server` }
    case 'xp':
      return { value: `${e.xp.toLocaleString()} XP`, sub: `Level ${e.level} · this server` }
    case 'reputation':
      return { value: `${e.reputation}/100`, sub: 'Global · all Pulse servers' }
    case 'active':
      return {
        value: `${e.messages.toLocaleString()} msg`,
        sub: e.voiceSeconds > 0 ? `${formatDuration(e.voiceSeconds)} voice` : 'No voice',
      }
  }
}

/**
 * "Richest" board — global Pulse Coin wallets ranked by balance. These are
 * GLOBAL wallets (the holder may not be a member of this guild), so rows carry
 * no avatar and aren't clickable, unlike the server-member boards above.
 */
function RichestBoard({ rows }: { rows: EconomyUser[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Coins size={36} />}
        title="No wallets yet"
        description="Members start earning Pulse Coins the moment they're active in any server running Pulse."
      />
    )
  }
  return (
    <div className="space-y-2">
      {rows.map((u, i) => (
        <div
          key={u.user_id}
          className="leaderboard-row flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
        >
          <RankBadge rank={i + 1} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-foreground">{u.user_name ?? u.user_id}</p>
            <p className="mt-0.5 text-[11px] text-subtle">
              {formatCoins(u.lifetime_earned)} earned all-time
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-sm font-bold text-foreground">{formatCoins(u.balance)}</p>
            <p className="text-[11px] text-subtle">Pulse Coins</p>
          </div>
        </div>
      ))}
    </div>
  )
}

export function MembersLeaderboard({ guildId, linkToProfiles = true }: Props) {
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
          <RichestBoard rows={data.richest} />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<Trophy size={36} />}
            title="Nothing to rank yet"
            description={board === 'active' ? 'No tracked activity in this timeframe.' : 'No members have earned XP yet — activity will populate the board.'}
          />
        ) : (
          <div className="space-y-2">
            {entries.map((e, i) => {
              const m = metric(board, e)
              const interactive = linkToProfiles
              const row = (
                <>
                  <RankBadge rank={i + 1} />
                  <Image src={e.avatar} alt={e.name} width={36} height={36} unoptimized className="shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{e.name}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <LevelBadge level={e.level} size="sm" />
                      <span
                        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium"
                        style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}
                        title="Global reputation — shared across every Pulse server"
                      >
                        <Globe size={9} />
                        {e.reputation}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm font-bold text-foreground">{m.value}</p>
                    <p className="text-[11px] text-subtle">{m.sub}</p>
                  </div>
                </>
              )
              if (!interactive) {
                return (
                  <div
                    key={e.userId}
                    className="leaderboard-row flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left"
                    style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
                  >
                    {row}
                  </div>
                )
              }
              return (
                <button
                  key={e.userId}
                  onClick={() => router.push(`/dashboard/${guildId}/members/${e.userId}`)}
                  className="leaderboard-row flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors"
                  style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
                  onMouseEnter={(ev) => { ev.currentTarget.style.background = 'var(--bg-2)' }}
                  onMouseLeave={(ev) => { ev.currentTarget.style.background = 'var(--panel)' }}
                >
                  {row}
                </button>
              )
            })}
          </div>
        )}
      </CategorySection>
    </div>
  )
}
