'use client'

import { useCallback, useEffect, useState } from 'react'
import { Coins, Globe, Medal, Server, Sparkles, Star, Trophy } from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { ChartCard } from '@/components/dashboard/charts/ChartCard'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCoins, type EconomyUser } from '@/lib/economy'
import type { Reputation } from '@/lib/reputation'

type Props = {
  guildId: string
  userId: string
  /** The member's global 0-100 trust score (same value shown at the top of the
   *  profile) — passed in so there is exactly one reputation on the page. */
  reputation: Reputation | null
}

type ProfileData = {
  wallet: EconomyUser | null
  ranks: { balance: number | null }
  servers: { guild_id: string; guild_name: string | null; level: number; xp: number }[]
  achievements: number
}

type Tab = 'server' | 'global'

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4" style={{ background: 'var(--bg-2)', borderColor: 'var(--line)' }}>
      <div className="mb-2 flex items-center gap-2 text-xs text-subtle">
        <span style={{ color: 'var(--p-1)' }}>{icon}</span>
        {label}
      </div>
      <p className="font-mono text-xl font-bold text-foreground">{value}</p>
      {sub && <p className="mt-1 text-xs text-subtle">{sub}</p>}
    </div>
  )
}

/**
 * The member's Pulse Profile: one card with two tabs.
 *   • This server — the member's level/XP standing in the current guild
 *     (server-specific progression — continues the Progression section above).
 *   • Global standing — the cross-server identity: coin balance, the global
 *     0-100 reputation (the same trust score shown at the top), global balance
 *     rank, total achievements and levels in every Pulse server.
 * The coin side is fetched here; reputation is passed in so there's one
 * canonical reputation on the page.
 */
export function GlobalPulseProfile({ guildId, userId, reputation }: Props) {
  const [tab, setTab] = useState<Tab>('server')
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/guilds/${guildId}/economy/profile?user=${userId}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      setData((await res.json()) as ProfileData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the Pulse profile.')
    } finally {
      setLoading(false)
    }
  }, [guildId, userId])

  useEffect(() => {
    load()
  }, [load])

  const section = (children: React.ReactNode) => (
    <CategorySection
      icon={<Sparkles size={14} />}
      title="Pulse Profile"
      helpId="economy"
      description="This member's standing in this server, and across every server running Pulse."
    >
      {children}
    </CategorySection>
  )

  if (loading) return section(<Skeleton className="h-[220px]" />)
  if (error || !data) {
    return section(
      <p className="rounded-xl border p-4 text-sm text-subtle" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        {error ?? 'The Pulse profile is unavailable right now.'}
      </p>,
    )
  }

  const wallet = data.wallet
  const repScore = reputation?.score ?? 0
  const repLabel = reputation?.label ?? 'Unknown'
  const repColor = reputation?.color ?? 'var(--text-muted)'
  const thisServer = data.servers.find((s) => s.guild_id === guildId) ?? null

  const segment = (active: boolean): React.CSSProperties =>
    active ? { background: 'var(--p-soft)', color: 'var(--text)' } : { color: 'var(--text-2)' }

  const toggle = (
    <div className="inline-flex rounded-lg border p-0.5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <button
        onClick={() => setTab('server')}
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
        style={segment(tab === 'server')}
      >
        <Server size={12} style={tab === 'server' ? { color: 'var(--p-1)' } : undefined} />
        This server
      </button>
      <button
        onClick={() => setTab('global')}
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
        style={segment(tab === 'global')}
      >
        <Globe size={12} style={tab === 'global' ? { color: 'var(--p-1)' } : undefined} />
        Global standing
      </button>
    </div>
  )

  return section(
    <div>
      <div className="mb-4">{toggle}</div>

      {tab === 'server' ? (
        <ChartCard
          title="This server"
          subtitle="Level and XP earned here — progression is unique to each server"
          icon={<Trophy size={15} />}
          disableLandscape
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat
              label="Level"
              value={String(thisServer?.level ?? 0)}
              sub="Server-specific — starts at 0 in every server"
              icon={<Sparkles size={13} />}
            />
            <Stat
              label="XP earned here"
              value={`${(thisServer?.xp ?? 0).toLocaleString()} XP`}
              sub="From messages, voice, commands and events"
              icon={<Trophy size={13} />}
            />
          </div>
          <p className="mt-4 flex items-center gap-2 text-xs text-subtle">
            <Globe size={12} />
            Balance and reputation aren&apos;t tied to this server — see the Global standing tab.
          </p>
        </ChartCard>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartCard
              title="Global standing"
              subtitle="Balance and reputation, earned across every Pulse server"
              icon={<Globe size={15} />}
              disableLandscape
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Stat
                  label="Balance"
                  value={`${formatCoins(wallet?.balance ?? 0)} coins`}
                  sub={
                    data.ranks.balance
                      ? `Global rank #${data.ranks.balance} · ${formatCoins(wallet?.lifetime_earned ?? 0)} earned all-time`
                      : 'No coins earned yet'
                  }
                  icon={<Coins size={13} />}
                />
                <Stat
                  label="Reputation"
                  value={`${repScore} / 100`}
                  sub={`${repLabel} · trust across every Pulse server`}
                  icon={<Star size={13} />}
                />
                <Stat
                  label="Servers"
                  value={String(data.servers.length || 0)}
                  sub="Pulse servers with tracked progression"
                  icon={<Server size={13} />}
                />
                <Stat
                  label="Achievements"
                  value={String(data.achievements)}
                  sub="Milestones earned across all servers"
                  icon={<Medal size={13} />}
                />
              </div>
              {/* Reputation score bar (0-100). */}
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium" style={{ color: repColor }}>{repLabel}</span>
                  <span className="text-subtle">{repScore} / 100</span>
                </div>
                <div className="h-2 w-full rounded-full" style={{ background: 'var(--bg-2)' }}>
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{ width: `${repScore}%`, background: repColor }}
                  />
                </div>
              </div>
            </ChartCard>
          </div>

          <ChartCard
            title="Server levels"
            subtitle="Per-server progression (not shared)"
            icon={<Trophy size={15} />}
            disableLandscape
          >
            {data.servers.length === 0 ? (
              <p className="py-2 text-sm text-subtle">No tracked levels yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {data.servers.slice(0, 8).map((s) => (
                  <li key={s.guild_id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-muted-foreground">
                      {s.guild_id === guildId ? (
                        <span className="font-medium text-foreground">{s.guild_name ?? 'This server'}</span>
                      ) : (
                        s.guild_name ?? `Server ${s.guild_id.slice(0, 6)}…`
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-foreground">
                      Lvl {s.level} · {s.xp.toLocaleString()} XP
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        </div>
      )}
    </div>,
  )
}
