import Link from 'next/link'
import Image from 'next/image'
import {
  Server, Users, ShieldAlert, ListChecks, ArrowRight,
  Activity as ActivityIcon, TrendingUp, Building2, Coins, Globe, Wallet,
} from 'lucide-react'
import { formatCoins, normaliseEconomyUser } from '@/lib/economy'
import { createClient } from '@/lib/supabase-server'
import { guildIconUrl } from '@/lib/discord'
import { getWorkspace, getWorkspaceMembers, getWorkspaceServers, enrichWorkspaceServers } from '@/lib/workspace-data'
import {
  countRoles, timeAgo, ROLE_BADGE, ROLE_LABELS, WORKSPACE_ROLES,
  ACTIVITY_CATEGORY_ACCENT, type WorkspaceActivityRow,
} from '@/lib/workspace'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { WorkspaceSettings } from '@/components/workspace/WorkspaceSettings'

export default async function WorkspaceOverviewPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const supabase = await createClient()

  const [workspace, members, servers] = await Promise.all([
    getWorkspace(workspaceId),
    getWorkspaceMembers(workspaceId),
    getWorkspaceServers(workspaceId),
  ])
  if (!workspace) return null

  const [enriched, incidentsRes, tasksRes, activityRes, economyTotalsRes, richestRes] = await Promise.all([
    enrichWorkspaceServers(servers),
    supabase.from('workspace_incidents').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).in('status', ['open', 'investigating']),
    supabase.from('workspace_tasks').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).neq('status', 'done'),
    supabase.from('workspace_activity').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(8),
    // Global economy snapshot (PULSIFY-45): one Pulse-wide coin pool — these
    // numbers are GLOBAL by design, identical from every workspace.
    supabase.rpc('economy_totals'),
    supabase.from('economy_users').select('*').order('balance', { ascending: false }).limit(5),
  ])

  const roleCounts = countRoles(members)
  const activity = (activityRes.data ?? []) as WorkspaceActivityRow[]
  const base = `/workspace/${workspaceId}`

  const economyTotalsRow = Array.isArray(economyTotalsRes.data)
    ? economyTotalsRes.data[0]
    : economyTotalsRes.data
  const circulation = Number(economyTotalsRow?.circulation ?? 0)
  const walletCount = Number(economyTotalsRow?.user_count ?? 0)
  const richest = (richestRes.data ?? []).map((r) => normaliseEconomyUser(r as Record<string, unknown>))

  const stats = [
    { label: 'Servers', value: servers.length, icon: <Server size={16} />, href: `${base}/servers` },
    { label: 'Team members', value: members.length, icon: <Users size={16} />, href: `${base}/team` },
    { label: 'Open incidents', value: incidentsRes.count ?? 0, icon: <ShieldAlert size={16} />, href: `${base}/incidents` },
    { label: 'Open tasks', value: tasksRes.count ?? 0, icon: <ListChecks size={16} />, href: `${base}/tasks` },
  ]

  return (
    <div className="page-content">
      <PageHeader
        title={workspace.name}
        helpId="workspace-overview"
        description={`${servers.length} server${servers.length === 1 ? '' : 's'} · ${members.length} team member${members.length === 1 ? '' : 's'}`}
      />

      <div className="space-y-8">
      <CategorySection
        icon={<TrendingUp size={14} />}
        title="At a glance"
        description="Snapshot of activity across this workspace right now."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <Link key={s.label} href={s.href} className="rounded-xl border p-5 transition hover:border-[var(--p-1)]" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-3)' }}>
                <span style={{ color: 'var(--p-1)' }}>{s.icon}</span>{s.label}
              </div>
              <p className="mt-3 text-3xl font-bold text-foreground">{s.value}</p>
            </Link>
          ))}
        </div>
      </CategorySection>

      <CategorySection
        icon={<Globe size={14} />}
        title="Global economy"
        description="Pulse Coins and reputation are GLOBAL — one balance and one trust score per member across every server, including all servers in this workspace. Levels & XP stay per-server (see Analytics)."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-3)' }}>
              <Coins size={16} style={{ color: 'var(--p-1)' }} />Coins in circulation
            </div>
            <p className="mt-3 text-3xl font-bold text-foreground">{formatCoins(circulation)}</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>Global — shared across all Pulse servers</p>
          </div>
          <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-3)' }}>
              <Wallet size={16} style={{ color: 'var(--p-1)' }} />Wallets
            </div>
            <p className="mt-3 text-3xl font-bold text-foreground">{walletCount.toLocaleString()}</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>Members holding a global balance</p>
          </div>
          <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-3)' }}>
              <TrendingUp size={16} style={{ color: 'var(--p-1)' }} />Top global balances
            </div>
            {richest.length === 0 ? (
              <p className="mt-3 text-sm" style={{ color: 'var(--text-3)' }}>No wallets yet — members earn coins the moment they&apos;re active.</p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {richest.map((u, i) => (
                  <li key={u.user_id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-muted-foreground">
                      <span className="mr-1.5 font-mono text-xs" style={{ color: 'var(--text-3)' }}>{i + 1}.</span>
                      {u.user_name ?? u.user_id}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-foreground">{formatCoins(u.balance)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CategorySection>

      <CategorySection
        icon={<Building2 size={14} />}
        title="Workspace"
        description="Connected servers, staff roles and recent activity."
      >
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Connected servers */}
        <section className="rounded-xl border lg:col-span-2" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: 'var(--line-strong)' }}>
            <h2 className="font-semibold text-foreground">Connected servers</h2>
            <Link href={`${base}/servers`} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--p-1)' }}>
              Manage <ArrowRight size={13} />
            </Link>
          </div>
          <div className="p-4">
            {enriched.length === 0 ? (
              <EmptyState icon={<Server size={28} />} title="No servers yet" description="Add Discord servers to manage them together." className="!py-10 !border-dashed" />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {enriched.slice(0, 6).map((s) => {
                  const icon = guildIconUrl(s.guild_id, s.icon, 48)
                  return (
                    <Link key={s.guild_id} href={`/dashboard/${s.guild_id}`} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 transition hover:border-[var(--p-1)]" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
                      {icon ? (
                        <Image src={icon} alt={s.name} width={32} height={32} className="h-8 w-8 rounded-lg" unoptimized />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>{s.name.charAt(0)}</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
                        <p className="text-xs" style={{ color: 'var(--text-3)' }}>{s.memberCount != null ? `${s.memberCount.toLocaleString()} members` : 'Bot not connected'}</p>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* Right column: roles + activity */}
        <div className="space-y-4">
          <section className="rounded-xl border p-6" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <h2 className="font-semibold text-foreground">Staff roles</h2>
            <div className="mt-4 space-y-2">
              {WORKSPACE_ROLES.map((role) => {
                const badge = ROLE_BADGE[role]
                return (
                  <div key={role} className="flex items-center justify-between">
                    <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>{ROLE_LABELS[role]}</span>
                    <span className="text-sm font-medium text-foreground">{roleCounts[role]}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border p-6" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground">Recent activity</h2>
              <Link href={`${base}/activity`} className="text-xs font-medium" style={{ color: 'var(--p-1)' }}>View all</Link>
            </div>
            <div className="mt-4 space-y-3">
              {activity.length === 0 ? (
                <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-3)' }}><ActivityIcon size={14} /> Nothing yet.</p>
              ) : (
                activity.map((a) => (
                  <div key={a.id} className="flex gap-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: ACTIVITY_CATEGORY_ACCENT[a.category] ?? 'var(--p-1)' }} />
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">{a.summary ?? a.action}</p>
                      <p className="text-xs" style={{ color: 'var(--text-3)' }}>{timeAgo(a.created_at)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
      </CategorySection>

      {/* Workspace settings — embedded directly into Overview so branding +
          ownership + danger zone are part of the same surface, not a separate
          tab. WorkspaceSettings is a client component that adapts to the
          viewer's capabilities (read-only for non-managers). */}
      <WorkspaceSettings />
      </div>
    </div>
  )
}
