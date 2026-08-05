'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Trophy, Sparkles, Zap, Activity, AlertCircle, Users, BarChart3, Globe, Server, Coins, UserPlus, Gamepad2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { CategorySection } from '@/components/ui/category-section'
import { Pagination } from '@/components/ui/pagination'
import { SortableHeader, nextSort, type SortDirection } from '@/components/ui/sortable-header'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { createClient as createSupabase } from '@/lib/supabase'
import { formatDuration } from '@/lib/analytics'
import { formatCoins } from '@/lib/economy'
import { displayName as gamingDisplayName, formatDuration as formatPlaytime } from '@/lib/gaming'
import { reputationFromScore } from '@/lib/reputation'
import type { BoardId, GamingBoardEntry, InviteBoardEntry, LeaderboardEntry, LeaderboardResponse, RichestEntry } from '@/lib/member-profile'
import { LevelBadge, ReputationBadge } from '@/components/dashboard/members/badges'
import { RankBadge } from '@/components/dashboard/RankBadge'

// The board ids (level/reputation/active, plus "richest" from the economy and
// "invites" from the referral system) live in lib/member-profile so server
// components can validate a `?board=` deep link without pulling in this module.
// ("Server XP" was folded into "Server level" — that board already shows XP.)

type Props = {
  guildId: string
  /** Whether rows are clickable through to a profile. */
  linkToProfiles?: boolean
  /** Which profile route a row opens: `members` = admin detail (default),
   *  `profile` = the read-only member-facing profile. */
  profileBasePath?: 'members' | 'profile'
  /** Board to open on first render (deep links, e.g. `?board=invites`). */
  initialBoard?: BoardId
}

// Each board is explicitly scoped: level/activity/invites are SERVER metrics,
// while reputation and richest are GLOBAL — shared across every Pulse server.
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
  { key: 'invites', label: 'Top inviters', icon: <UserPlus size={15} />, scope: 'server' },
  { key: 'gaming', label: 'Gaming', icon: <Gamepad2 size={15} />, scope: 'server' },
]

const WINDOWS: { key: string; label: string }[] = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'all', label: 'All time' },
]

// ── Sorting ────────────────────────────────────────────────────────────────
// Every board table sorts in the browser, the same way the Members directory
// does: the server sends the ranked list, `rank` (the "#" column) is the
// default, and any other header re-orders the rows without another request.
// "#" ascending is therefore always "the board's own ranking".

type SortState = { key: string; dir: SortDirection }

const RANK_SORT: SortState = { key: 'rank', dir: 'asc' }

/** Columns where the useful first click is A→Z / smallest-first. */
const ASCENDING_FIRST = new Set(['rank', 'name'])

function nextBoardSort(current: SortState, key: string): SortState {
  return nextSort(current, key, ASCENDING_FIRST.has(key) ? 'asc' : 'desc')
}

/** A row with the place it holds on the board, fixed before any sorting. */
type Ranked<T> = { rank: number; row: T }

/**
 * Number the board (the server's ranking IS the rank), then order the rows for
 * the current sort. `rank` sorts by that number; any other key reads a value out
 * of the row — strings compare by locale, everything else numerically.
 *
 * The rank travels with the row rather than being derived from its position, so
 * sorting by another column re-orders the table without ever renumbering anyone:
 * "#" always means "place on this board".
 */
function rankAndSort<T>(
  rows: T[],
  sort: SortState,
  values: Record<string, (row: T) => number | string>,
): Ranked<T>[] {
  const ranked = rows.map((row, i) => ({ rank: i + 1, row }))
  const mul = sort.dir === 'asc' ? 1 : -1
  if (sort.key === 'rank' || !values[sort.key]) {
    return sort.dir === 'asc' ? ranked : ranked.reverse()
  }
  const read = values[sort.key]
  return ranked.sort((a, b) => {
    const av = read(a.row)
    const bv = read(b.row)
    const cmp =
      typeof av === 'string' || typeof bv === 'string'
        ? String(av).localeCompare(String(bv))
        : av - bv
    // Ties keep the board's own order, so equal values never shuffle randomly.
    return (cmp || a.rank - b.rank) * mul
  })
}

type SortProps = { sort: SortState; onSort: (key: string) => void }

/** Rank ("#") header — sortable in every board, and the default order. */
function RankHeader({ sort, onSort }: SortProps) {
  return (
    <th className="text-left" style={{ width: RANK_COL_WIDTH }}>
      <SortableHeader label="#" columnKey="rank" activeKey={sort.key} direction={sort.dir} onSort={onSort} />
    </th>
  )
}

function Header({ label, columnKey, sort, onSort }: SortProps & { label: string; columnKey: string }) {
  return (
    <th className="text-left">
      <SortableHeader label={label} columnKey={columnKey} activeKey={sort.key} direction={sort.dir} onSort={onSort} />
    </th>
  )
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

const MEMBER_VALUES: Record<string, (e: LeaderboardEntry) => number | string> = {
  name: (e) => e.name,
  level: (e) => e.level,
  xp: (e) => e.xp,
  reputation: (e) => e.reputation,
  messages: (e) => e.messages,
  voice: (e) => e.voiceSeconds,
}

const RICHEST_VALUES: Record<string, (u: RichestEntry) => number | string> = {
  name: (u) => u.user_name ?? u.user_id,
  lifetime: (u) => u.lifetime_earned,
  balance: (u) => u.balance,
}

const INVITE_VALUES: Record<string, (r: InviteBoardEntry) => number | string> = {
  name: (r) => r.name,
  score: (r) => r.score,
  valid: (r) => r.valid,
  retained: (r) => r.retained,
  fake: (r) => r.fake,
  bonus: (r) => r.bonus,
}

const GAMING_VALUES: Record<string, (e: GamingBoardEntry) => number | string> = {
  name: (e) => e.name,
  playtime: (e) => e.playSeconds,
  sessions: (e) => e.sessions,
  avgSession: (e) => e.avgSessionSeconds,
  longestSession: (e) => e.longestSeconds,
  variety: (e) => e.games,
  lastPlayed: (e) => (e.lastPlayedAt ? Date.parse(e.lastPlayedAt) : 0),
}

// Fixed width for the leading rank ("#") column. Pinning it to the same value in
// every board table means the Member column always starts at the same x-position
// — so it never shifts when you switch between boards.
const RANK_COL_WIDTH = 72
const RANK_CELL_STYLE: React.CSSProperties = { width: RANK_COL_WIDTH }

// Client-side pagination wired exactly like the Members directory: the parent
// slices the rows for the current page and passes the offset (so ranks keep
// counting across pages) plus the footer controls.
type Pager = {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

/**
 * Member boards (level / reputation / most-active) rendered in the same table
 * chrome as the Members directory: bordered container, stacked header, hover
 * rows that open the member's profile.
 */
function MemberBoardTable({
  entries,
  linkToProfiles,
  onOpen,
  pager,
  sort,
  onSort,
}: {
  entries: Ranked<LeaderboardEntry>[]
  linkToProfiles: boolean
  onOpen: (userId: string) => void
  pager: Pager
} & SortProps) {
  return (
    <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--line-strong)' }}>
      <table className="w-full min-w-[760px] text-sm table-stack">
        <thead>
          <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <RankHeader sort={sort} onSort={onSort} />
            <Header label="Member" columnKey="name" sort={sort} onSort={onSort} />
            {MEMBER_COLS.map((c) => (
              <Header key={c.key} label={c.label} columnKey={c.key} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map(({ rank, row: e }) => {
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
                <td className="px-4 py-3" data-label="" style={RANK_CELL_STYLE}><RankBadge rank={rank} /></td>
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
      <Pagination {...pager} />
    </div>
  )
}

/**
 * "Richest" board — global Pulse Coin wallets ranked by balance. Rendered in the
 * same table chrome as the member boards, with a profile icon (the holder's
 * guild avatar when they're a member here, otherwise their global Discord
 * avatar). The board is GLOBAL, so a holder can live on another Pulse server —
 * every row is clickable: members open their full server profile, outsiders open
 * their global Pulse profile (`inGuild` just flags the "Other server" badge).
 */
function RichestTable({
  rows,
  linkToProfiles,
  onOpen,
  pager,
  sort,
  onSort,
}: {
  rows: Ranked<RichestEntry>[]
  linkToProfiles: boolean
  onOpen: (userId: string) => void
  pager: Pager
} & SortProps) {
  return (
    <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--line-strong)' }}>
      <table className="w-full min-w-[520px] text-sm table-stack">
        <thead>
          <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <RankHeader sort={sort} onSort={onSort} />
            <Header label="Member" columnKey="name" sort={sort} onSort={onSort} />
            <Header label="Earned all-time" columnKey="lifetime" sort={sort} onSort={onSort} />
            <Header label="Balance" columnKey="balance" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ rank, row: u }) => {
            const interactive = linkToProfiles
            return (
              <tr
                key={u.user_id}
                onClick={interactive ? () => onOpen(u.user_id) : undefined}
                title={!u.inGuild ? 'On another Pulse server — opens their global profile' : undefined}
                className={`border-b transition-colors${interactive ? ' cursor-pointer' : ''}`}
                style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}
                onMouseEnter={interactive ? (ev) => { ev.currentTarget.style.background = 'var(--bg-2)' } : undefined}
                onMouseLeave={interactive ? (ev) => { ev.currentTarget.style.background = 'color-mix(in srgb, var(--panel) 50%, transparent)' } : undefined}
              >
                <td className="px-4 py-3" data-label="" style={RANK_CELL_STYLE}><RankBadge rank={rank} /></td>
                <td className="px-4 py-3" data-label="">
                  <div className="flex items-center gap-3">
                    <Image src={u.avatar} alt={u.user_name ?? u.user_id} width={30} height={30} unoptimized className="rounded-full shrink-0" />
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate font-medium text-foreground">{u.user_name ?? u.user_id}</p>
                      {!u.inGuild && (
                        <span className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
                          <Globe size={9} />
                          Other server
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground" data-label="Earned all-time">{formatCoins(u.lifetime_earned)}</td>
                <td className="px-4 py-3 font-mono text-sm font-bold text-foreground" data-label="Balance">{formatCoins(u.balance)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Pagination {...pager} />
    </div>
  )
}

// Columns for the invites board — `score` is the ranking dimension, so its
// header is accented the same way the member boards accent theirs.
const INVITE_COLS: { key: string; label: string }[] = [
  { key: 'score', label: 'Score' },
  { key: 'valid', label: 'Valid' },
  { key: 'retained', label: 'Retained' },
  { key: 'fake', label: 'Fake' },
  { key: 'bonus', label: 'Bonus' },
]

/**
 * "Invites" board — inviters ranked by score (valid + bonus − fake), moved here
 * from Engagement › Invites so every leaderboard lives on one page. Inviters who
 * have since left the server keep their stored name but aren't clickable, the
 * same rule the Richest board applies to out-of-guild wallet holders.
 */
function InviteBoardTable({
  rows,
  linkToProfiles,
  onOpen,
  pager,
  sort,
  onSort,
}: {
  rows: Ranked<InviteBoardEntry>[]
  linkToProfiles: boolean
  onOpen: (userId: string) => void
  pager: Pager
} & SortProps) {
  return (
    <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--line-strong)' }}>
      <table className="w-full min-w-[760px] text-sm table-stack">
        <thead>
          <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <RankHeader sort={sort} onSort={onSort} />
            <Header label="Member" columnKey="name" sort={sort} onSort={onSort} />
            {INVITE_COLS.map((c) => (
              <Header key={c.key} label={c.label} columnKey={c.key} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ rank, row: r }) => {
            const interactive = linkToProfiles && r.inGuild
            return (
              <tr
                key={r.userId}
                onClick={interactive ? () => onOpen(r.userId) : undefined}
                title={!r.inGuild ? 'This inviter has left the server' : undefined}
                className={`border-b transition-colors${interactive ? ' cursor-pointer' : ''}`}
                style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}
                onMouseEnter={interactive ? (ev) => { ev.currentTarget.style.background = 'var(--bg-2)' } : undefined}
                onMouseLeave={interactive ? (ev) => { ev.currentTarget.style.background = 'color-mix(in srgb, var(--panel) 50%, transparent)' } : undefined}
              >
                <td className="px-4 py-3" data-label="" style={RANK_CELL_STYLE}><RankBadge rank={rank} /></td>
                <td className="px-4 py-3" data-label="">
                  <div className="flex items-center gap-3">
                    <Image src={r.avatar} alt={r.name} width={30} height={30} unoptimized className="rounded-full shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{r.name}</p>
                      <p className="mt-0.5 truncate text-xs text-subtle">{r.retentionRate}% retention</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-sm font-bold text-foreground" data-label="Score">{r.score.toLocaleString()}</td>
                <td className="px-4 py-3 font-mono text-xs text-foreground" data-label="Valid">{r.valid.toLocaleString()}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground" data-label="Retained">{r.retained.toLocaleString()}</td>
                <td className="px-4 py-3 font-mono text-xs" data-label="Fake" style={{ color: r.fake > 0 ? '#f87171' : 'var(--text-3)' }}>{r.fake.toLocaleString()}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground" data-label="Bonus">{r.bonus > 0 ? r.bonus.toLocaleString() : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Pagination {...pager} />
    </div>
  )
}

// Gaming columns — every metric the board can be sorted by, plus "Last played".
const GAMING_COLS: { key: string; label: string }[] = [
  { key: 'playtime', label: 'Playtime' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'avgSession', label: 'Avg session' },
  { key: 'longestSession', label: 'Longest' },
  { key: 'variety', label: 'Games' },
  { key: 'lastPlayed', label: 'Last played' },
]

// The column the table is currently sorted by is emphasised; the rest stay muted.
function metricCellClass(active: boolean): string {
  return active
    ? 'px-4 py-3 font-mono text-sm font-bold text-foreground'
    : 'px-4 py-3 font-mono text-xs text-muted-foreground'
}

function playedAgo(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff)) return '—'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`
}

/**
 * "Gaming" board — play activity ranked from Discord presence sessions, moved
 * here from Analytics › Gaming › Players. When the guild anonymises its gaming
 * statistics the rows show a rank instead of a member, and nothing is clickable.
 */
function GamingBoardTable({
  rows,
  anonymised,
  linkToProfiles,
  onOpen,
  pager,
  sort,
  onSort,
}: {
  rows: Ranked<GamingBoardEntry>[]
  anonymised: boolean
  linkToProfiles: boolean
  onOpen: (userId: string) => void
  pager: Pager
} & SortProps) {
  return (
    <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--line-strong)' }}>
      <table className="w-full min-w-[960px] text-sm table-stack">
        <thead>
          <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <RankHeader sort={sort} onSort={onSort} />
            <Header label="Member" columnKey="name" sort={sort} onSort={onSort} />
            {GAMING_COLS.map((c) => (
              <Header key={c.key} label={c.label} columnKey={c.key} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ rank, row: e }) => {
            const interactive = linkToProfiles && e.inGuild && !anonymised
            return (
              <tr
                key={e.userId}
                onClick={interactive ? () => onOpen(e.userId) : undefined}
                title={!anonymised && !e.inGuild ? 'This member has left the server' : undefined}
                className={`border-b transition-colors${interactive ? ' cursor-pointer' : ''}`}
                style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}
                onMouseEnter={interactive ? (ev) => { ev.currentTarget.style.background = 'var(--bg-2)' } : undefined}
                onMouseLeave={interactive ? (ev) => { ev.currentTarget.style.background = 'color-mix(in srgb, var(--panel) 50%, transparent)' } : undefined}
              >
                <td className="px-4 py-3" data-label="" style={RANK_CELL_STYLE}><RankBadge rank={rank} /></td>
                <td className="px-4 py-3" data-label="">
                  <div className="flex items-center gap-3">
                    {!anonymised && (
                      <Image src={e.avatar} alt={e.name} width={30} height={30} unoptimized className="rounded-full shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate font-medium text-foreground">
                        {gamingDisplayName({ userId: e.userId, userName: e.name }, anonymised, rank)}
                        {e.currentlyPlaying && (
                          <span
                            title="Playing right now"
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: 'var(--green)' }}
                          />
                        )}
                      </p>
                      {!anonymised && e.favouriteGame && (
                        <p className="mt-0.5 truncate text-xs text-subtle">{e.favouriteGame}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className={metricCellClass(sort.key === 'playtime')} data-label="Playtime">{formatPlaytime(e.playSeconds)}</td>
                <td className={metricCellClass(sort.key === 'sessions')} data-label="Sessions">{e.sessions.toLocaleString()}</td>
                <td className={metricCellClass(sort.key === 'avgSession')} data-label="Avg session">{formatPlaytime(e.avgSessionSeconds)}</td>
                <td className={metricCellClass(sort.key === 'longestSession')} data-label="Longest">{formatPlaytime(e.longestSeconds)}</td>
                <td className={metricCellClass(sort.key === 'variety')} data-label="Games">{e.games.toLocaleString()}</td>
                <td className="px-4 py-3 text-xs text-subtle" data-label="Last played">{playedAgo(e.lastPlayedAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Pagination {...pager} />
    </div>
  )
}

export function MembersLeaderboard({ guildId, linkToProfiles = true, profileBasePath = 'members', initialBoard }: Props) {
  const router = useRouter()
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [board, setBoard] = useState<BoardId>(initialBoard ?? 'level')
  const [window, setWindow] = useState('30d')
  // Tables sort in the browser; "#" (the board's own ranking) is the default.
  const [sort, setSort] = useState<SortState>(RANK_SORT)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Switching board or timeframe re-ranks the list, so jump back to page 1.
  useEffect(() => {
    setPage(1)
  }, [board, window])

  function handleSort(key: string) {
    setSort((prev) => nextBoardSort(prev, key))
    setPage(1)
  }

  // Each board has its own columns, so changing board starts from the ranking
  // again rather than carrying a sort key the next table doesn't have.
  function selectBoard(next: BoardId) {
    setBoard(next)
    setSort(RANK_SORT)
    setPage(1)
  }

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

  // Gaming is admin-only, so a member (or a deep link) can ask for a board that
  // isn't theirs to see — fall back to the default rather than render nothing.
  const gamingVisible = data.gamingVisible ?? false
  const activeBoard: BoardId = board === 'gaming' && !gamingVisible ? 'level' : board
  const visibleBoards = BOARDS.filter((b) => b.key !== 'gaming' || gamingVisible)

  // The server sends each board already ranked; the header sort re-orders that
  // list in place (every column's value travels with the row), so switching
  // sort never costs a request.
  const entries = rankAndSort(
    activeBoard === 'richest' || activeBoard === 'invites' || activeBoard === 'gaming'
      ? []
      : data.boards[activeBoard],
    sort,
    MEMBER_VALUES,
  )
  const richestRows = rankAndSort(data.richest, sort, RICHEST_VALUES)
  const inviteRows = rankAndSort(data.inviteBoard ?? [], sort, INVITE_VALUES)
  const gamingRows = rankAndSort(data.gamingBoard ?? [], sort, GAMING_VALUES)
  const maxDist = Math.max(1, ...data.distribution.map((d) => d.count))

  // Client-side pagination, mirroring the Members directory: clamp the page,
  // slice the active list, and hand the offset to the table so ranks continue
  // counting from the right number across pages.
  const total =
    activeBoard === 'richest'
      ? richestRows.length
      : activeBoard === 'invites'
        ? inviteRows.length
        : activeBoard === 'gaming'
          ? gamingRows.length
          : entries.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const pageStart = (safePage - 1) * pageSize
  const pagedEntries = entries.slice(pageStart, pageStart + pageSize)
  const pagedRichest = richestRows.slice(pageStart, pageStart + pageSize)
  const pagedInvites = inviteRows.slice(pageStart, pageStart + pageSize)
  const pagedGaming = gamingRows.slice(pageStart, pageStart + pageSize)
  const pager: Pager = {
    page: safePage,
    pageSize,
    total,
    onPageChange: setPage,
    onPageSizeChange: (size) => { setPageSize(size); setPage(1) },
  }

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
      <CategorySection icon={<Trophy size={14} />} title="Leaderboard" description="Rank members by server progression (level & XP), global reputation, recent activity, Pulse Coin wealth, invite referrals and gaming.">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex flex-wrap rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            {visibleBoards.map((b) => {
              const active = activeBoard === b.key
              return (
                <button
                  key={b.key}
                  onClick={() => selectBoard(b.key)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                  style={active ? { background: 'var(--p-soft)', color: 'var(--text)' } : { color: 'var(--text-2)' }}
                >
                  <span style={active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{b.icon}</span>
                  {b.label}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--line-strong)' }}>
              {WINDOWS.map((w) => {
                const active = window === w.key
                return (
                  <button
                    key={w.key}
                    onClick={() => setWindow(w.key)}
                    className="rounded-md px-2.5 py-1 text-xs font-medium transition"
                    style={{ background: active ? 'var(--p-soft)' : 'transparent', color: active ? 'var(--p-1)' : 'var(--text-3)' }}
                    title={
                      activeBoard === 'active' || activeBoard === 'invites' || activeBoard === 'gaming'
                        ? 'Filters this board’s timeframe'
                        : 'Only affects the “Most active”, “Top inviters” and “Gaming” boards'
                    }
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
          {activeBoard === 'reputation' ? (
            <>
              <Globe size={12} style={{ color: 'var(--p-1)' }} />
              <span className="font-medium text-muted-foreground">Global metric</span>
              — the 0–100 trust score each member carries across every server running Pulse.
            </>
          ) : activeBoard === 'richest' ? (
            <>
              <Globe size={12} style={{ color: 'var(--p-1)' }} />
              <span className="font-medium text-muted-foreground">Global metric</span>
              — Pulse Coin balances ranked across every server running Pulse.
            </>
          ) : (
            <>
              <Server size={12} style={{ color: 'var(--p-1)' }} />
              <span className="font-medium text-muted-foreground">Server metric</span>
              —{' '}
              {activeBoard === 'active'
                ? 'activity tracked in this server only.'
                : activeBoard === 'invites'
                  ? 'referrals attributed in this server only — score is valid + bonus − fake.'
                  : activeBoard === 'gaming'
                    ? 'play sessions read from Discord presence in this server only.'
                    : 'XP and levels are earned in this server only.'}
            </>
          )}
          {activeBoard !== 'active' && activeBoard !== 'invites' && activeBoard !== 'gaming' && (
            <span>Totals are all-time — the timeframe only filters the “Most active”, “Top inviters” and “Gaming” boards.</span>
          )}
          {activeBoard === 'invites' && window !== 'all' && (
            <span>Bonus credits are lifetime, so they only count on the all-time board.</span>
          )}
          {activeBoard === 'gaming' && data.gamingAnonymised && (
            <span>Anonymised statistics are on — players are shown by rank only.</span>
          )}
        </p>

        {activeBoard === 'gaming' ? (
          gamingRows.length === 0 ? (
            <EmptyState
              icon={<Gamepad2 size={36} />}
              title="No players tracked yet"
              description="Members appear here once they've played something Discord can see in this timeframe."
            />
          ) : (
            <GamingBoardTable
              rows={pagedGaming}
              anonymised={data.gamingAnonymised}
              linkToProfiles={linkToProfiles}
              onOpen={(userId) => router.push(`/dashboard/${guildId}/${profileBasePath}/${userId}`)}
              pager={pager}
              sort={sort}
              onSort={handleSort}
            />
          )
        ) : activeBoard === 'invites' ? (
          inviteRows.length === 0 ? (
            <EmptyState
              icon={<UserPlus size={36} />}
              title="No ranked inviters yet"
              description={
                data.invitesEnabled
                  ? 'The board fills in as members join through tracked invites in this timeframe.'
                  : 'Invite tracking is off — joins aren’t attributed or scored until you turn it on in Engagement › Invites.'
              }
            />
          ) : (
            <InviteBoardTable
              rows={pagedInvites}
              linkToProfiles={linkToProfiles}
              onOpen={(userId) => router.push(`/dashboard/${guildId}/${profileBasePath}/${userId}`)}
              pager={pager}
              sort={sort}
              onSort={handleSort}
            />
          )
        ) : activeBoard === 'richest' ? (
          richestRows.length === 0 ? (
            <EmptyState
              icon={<Coins size={36} />}
              title="No wallets yet"
              description="Members start earning Pulse Coins the moment they're active in any server running Pulse."
            />
          ) : (
            <RichestTable
              rows={pagedRichest}
              linkToProfiles={linkToProfiles}
              onOpen={(userId) => router.push(`/dashboard/${guildId}/${profileBasePath}/${userId}`)}
              pager={pager}
              sort={sort}
              onSort={handleSort}
            />
          )
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<Trophy size={36} />}
            title="Nothing to rank yet"
            description={activeBoard === 'active' ? 'No tracked activity in this timeframe.' : 'No members have earned XP yet — activity will populate the board.'}
          />
        ) : (
          <MemberBoardTable
            entries={pagedEntries}
            linkToProfiles={linkToProfiles}
            onOpen={(userId) => router.push(`/dashboard/${guildId}/${profileBasePath}/${userId}`)}
            pager={pager}
            sort={sort}
            onSort={handleSort}
          />
        )}
      </CategorySection>
    </div>
  )
}
