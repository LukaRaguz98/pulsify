import { redirect } from 'next/navigation'
import Image from 'next/image'
import { MessageSquare, UserPlus, UserMinus, Shield, Users, Mic, TrendingUp, BarChart3, Trophy, Globe, Coins } from 'lucide-react'
import { formatCoins } from '@/lib/economy'
import { createClient } from '@/lib/supabase-server'
import { guildIconUrl } from '@/lib/discord'
import { authorizeWorkspaceMember } from '@/lib/workspace-auth'
import { getWorkspaceServers, enrichWorkspaceServers } from '@/lib/workspace-data'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'

type Summary = {
  total_messages: number
  total_commands: number
  total_mod_actions: number
  member_joins: number
  member_leaves: number
  active_users: number
  voice_seconds: number
}

const n = (v: unknown) => Number(v ?? 0)

export default async function WorkspaceAnalyticsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params

  // Page-level capability gate (nav hides it, but enforce on direct navigation).
  const auth = await authorizeWorkspaceMember(workspaceId, 'viewAnalytics')
  if (!auth.ok) redirect(`/workspace/${workspaceId}`)

  const supabase = await createClient()
  const servers = await getWorkspaceServers(workspaceId)
  const enriched = await enrichWorkspaceServers(servers)
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()

  // Reuse the existing per-guild analytics RPC across the workspace's servers —
  // no new SQL needed (same stance as insights/tickets).
  const perServer = await Promise.all(
    enriched.map(async (s) => {
      const { data } = await supabase.rpc('get_analytics_summary', { p_guild_id: s.guild_id, p_since: since })
      const row = (Array.isArray(data) ? data[0] : data) as Summary | undefined
      return {
        guildId: s.guild_id,
        name: s.name,
        icon: s.icon,
        messages: n(row?.total_messages),
        joins: n(row?.member_joins),
        leaves: n(row?.member_leaves),
        modActions: n(row?.total_mod_actions),
        activeUsers: n(row?.active_users),
        voiceMinutes: Math.round(n(row?.voice_seconds) / 60),
      }
    }),
  )

  const totals = perServer.reduce(
    (acc, s) => ({
      messages: acc.messages + s.messages,
      joins: acc.joins + s.joins,
      leaves: acc.leaves + s.leaves,
      modActions: acc.modActions + s.modActions,
      activeUsers: acc.activeUsers + s.activeUsers,
      voiceMinutes: acc.voiceMinutes + s.voiceMinutes,
    }),
    { messages: 0, joins: 0, leaves: 0, modActions: 0, activeUsers: 0, voiceMinutes: 0 },
  )

  const maxMessages = Math.max(1, ...perServer.map((s) => s.messages))
  const ranked = [...perServer].sort((a, b) => b.messages - a.messages)

  // Cross-server progression (PULSIFY-45): per-server XP ladders are LOCAL,
  // while the coin economy is GLOBAL — surface both, clearly labelled.
  const guildIds = enriched.map((s) => s.guild_id)
  const [progressionRes, economyTotalsRes] = await Promise.all([
    guildIds.length
      ? supabase.rpc('get_guild_progression_totals', { p_guild_ids: guildIds })
      : Promise.resolve({ data: [] as unknown }),
    supabase.rpc('economy_totals'),
  ])
  const progressionByGuild = new Map<string, { tracked: number; totalXp: number; topLevel: number }>()
  for (const r of (progressionRes.data ?? []) as Record<string, unknown>[]) {
    progressionByGuild.set(String(r.guild_id), {
      tracked: n(r.tracked),
      totalXp: n(r.total_xp),
      topLevel: n(r.top_level),
    })
  }
  const economyTotalsRow = Array.isArray(economyTotalsRes.data)
    ? economyTotalsRes.data[0]
    : economyTotalsRes.data
  const circulation = n((economyTotalsRow as Record<string, unknown> | null | undefined)?.circulation)
  const progression = enriched.map((s) => ({
    guildId: s.guild_id,
    name: s.name,
    icon: s.icon,
    ...(progressionByGuild.get(s.guild_id) ?? { tracked: 0, totalXp: 0, topLevel: 0 }),
  }))
  const maxXp = Math.max(1, ...progression.map((s) => s.totalXp))
  const rankedProgression = [...progression].sort((a, b) => b.totalXp - a.totalXp)

  const stats = [
    { label: 'Messages', value: totals.messages, icon: <MessageSquare size={16} /> },
    { label: 'Member joins', value: totals.joins, icon: <UserPlus size={16} /> },
    { label: 'Member leaves', value: totals.leaves, icon: <UserMinus size={16} /> },
    { label: 'Mod actions', value: totals.modActions, icon: <Shield size={16} /> },
    { label: 'Active members', value: totals.activeUsers, icon: <Users size={16} /> },
    { label: 'Voice minutes', value: totals.voiceMinutes, icon: <Mic size={16} /> },
  ]

  return (
    <div className="page-content">
      <PageHeader title="Analytics" helpId="workspace-analytics" description="A centralized 30-day overview across every server in this workspace." />

      {enriched.length === 0 ? (
        <EmptyState icon={<MessageSquare size={30} />} title="No servers connected" description="Add servers to compare their engagement here." />
      ) : (
        <div className="space-y-8">
          <CategorySection
            icon={<TrendingUp size={14} />}
            title="At a glance"
            description="Combined totals across every connected server in the last 30 days."
          >
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                  <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><span style={{ color: 'var(--p-1)' }}>{s.icon}</span>{s.label}</div>
                  <p className="mt-2 text-2xl font-bold text-foreground">{s.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </CategorySection>

          <CategorySection
            icon={<BarChart3 size={14} />}
            title="Engagement by server"
            description="Messages over the last 30 days — ranked by volume."
          >
          <section className="rounded-xl border" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <div className="divide-y" style={{ borderColor: 'var(--line-strong)' }}>
              {ranked.map((s) => {
                const icon = guildIconUrl(s.guildId, s.icon, 40)
                const pct = Math.round((s.messages / maxMessages) * 100)
                return (
                  <div key={s.guildId} className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {icon ? (
                        <Image src={icon} alt={s.name} width={28} height={28} className="h-7 w-7 rounded-lg" unoptimized />
                      ) : (
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>{s.name.charAt(0)}</div>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{s.name}</span>
                      <span className="text-sm font-semibold text-foreground">{s.messages.toLocaleString()}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--p-1), var(--p-2))' }} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
                      <span>{s.activeUsers.toLocaleString()} active</span>
                      <span>+{s.joins.toLocaleString()} joins</span>
                      <span>−{s.leaves.toLocaleString()} leaves</span>
                      <span>{s.modActions.toLocaleString()} mod actions</span>
                      <span>{s.voiceMinutes.toLocaleString()} voice min</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
          </CategorySection>

          <CategorySection
            icon={<Trophy size={14} />}
            title="Cross-server progression"
            description="Each server's XP ladder is local — members start fresh on every server. Coins & reputation are global and identical everywhere."
          >
            <div
              className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
            >
              <Globe size={15} style={{ color: 'var(--p-1)' }} />
              <span className="font-medium text-foreground">Global economy:</span>
              <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
                <Coins size={13} style={{ color: 'var(--p-1)' }} />
                {formatCoins(circulation)} coins in circulation across all Pulse servers
              </span>
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                — shared, not per-server
              </span>
            </div>
            <section className="rounded-xl border" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <div className="divide-y" style={{ borderColor: 'var(--line-strong)' }}>
                {rankedProgression.map((s) => {
                  const icon = guildIconUrl(s.guildId, s.icon, 40)
                  const pct = Math.round((s.totalXp / maxXp) * 100)
                  return (
                    <div key={s.guildId} className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {icon ? (
                          <Image src={icon} alt={s.name} width={28} height={28} className="h-7 w-7 rounded-lg" unoptimized />
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>{s.name.charAt(0)}</div>
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{s.name}</span>
                        <span className="text-sm font-semibold text-foreground">{s.totalXp.toLocaleString()} XP</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--p-1), var(--p-2))' }} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
                        <span>{s.tracked.toLocaleString()} members levelling</span>
                        <span>top level {s.topLevel}</span>
                        <span>server-specific ladder</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </CategorySection>
        </div>
      )}
    </div>
  )
}
