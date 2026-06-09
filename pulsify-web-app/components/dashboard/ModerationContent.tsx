'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Shield,
  Ban,
  RefreshCw,
  Users,
  ScrollText,
  Loader2,
  AlertTriangle,
  Clock,
  TrendingUp,
} from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import type { EnrichedBan, DiscordMember, DiscordRole, BotPermissions } from '@/lib/discord'
import type { TimeoutMeta } from '@/app/api/discord/guild/[guildId]/moderation/timeout-meta/route'
import { botInviteUrl } from '@/lib/discord'
import { createClient as createSupabase } from '@/lib/supabase'
import { PageHeader } from '@/components/ui/page-header'
import { MembersTab } from '@/components/dashboard/moderation/MembersTab'
import { BansTab } from '@/components/dashboard/moderation/BansTab'
import { TimeoutsTab } from '@/components/dashboard/moderation/TimeoutsTab'
import { LogsTab } from '@/components/dashboard/moderation/LogsTab'

type Tab = 'members' | 'timeouts' | 'bans' | 'logs'

type Props = { guildId: string }

const POLL_INTERVAL = 30_000

export function ModerationContent({ guildId }: Props) {
  const [tab, setTab] = useState<Tab>('members')
  const [members, setMembers] = useState<DiscordMember[]>([])
  const [roles, setRoles] = useState<DiscordRole[]>([])
  const [bans, setBans] = useState<EnrichedBan[]>([])
  const [timeoutMeta, setTimeoutMeta] = useState<TimeoutMeta[]>([])
  const [botPerms, setBotPerms] = useState<BotPermissions | null>(null)
  const [botPermsResolved, setBotPermsResolved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [secondsAgo, setSecondsAgo] = useState(0)
  const [logsRefreshKey, setLogsRefreshKey] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const [membersRes, rolesRes, bansRes, permsRes, timeoutMetaRes] = await Promise.all([
        fetch(`/api/discord/guild/${guildId}/members?limit=1000`, { cache: 'no-store' }),
        fetch(`/api/discord/guild/${guildId}/roles`, { cache: 'no-store' }),
        fetch(`/api/discord/guild/${guildId}/bans`, { cache: 'no-store' }),
        fetch(`/api/discord/guild/${guildId}/bot-permissions`, { cache: 'no-store' }),
        fetch(`/api/discord/guild/${guildId}/moderation/timeout-meta`, { cache: 'no-store' }),
      ])
      if (membersRes.ok) setMembers(await membersRes.json())
      if (rolesRes.ok) setRoles(await rolesRes.json())
      if (bansRes.ok) setBans(await bansRes.json())
      if (permsRes.ok) {
        setBotPerms(await permsRes.json())
        setBotPermsResolved(true)
      }
      if (timeoutMetaRes.ok) setTimeoutMeta(await timeoutMetaRes.json())
      setLastUpdated(new Date())
      setSecondsAgo(0)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [guildId])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    timerRef.current = setInterval(() => fetchData(true), POLL_INTERVAL)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [fetchData])

  // Live updates: subscribe to member_join / member_leave events the bot
  // writes to analytics_events for this guild and refresh immediately.
  useEffect(() => {
    const supabase = createSupabase()
    const channel = supabase
      .channel(`moderation:${guildId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'analytics_events',
          filter: `guild_id=eq.${guildId}`,
        },
        (payload) => {
          const evt = payload.new as { event_type?: string }
          if (evt.event_type === 'member_join' || evt.event_type === 'member_leave') {
            fetchData(true)
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [guildId, fetchData])

  useEffect(() => {
    const id = setInterval(() => {
      if (lastUpdated) {
        setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  function bumpAfterAction() {
    fetchData(true)
    setLogsRefreshKey((k) => k + 1)
  }

  const referenceTime = lastUpdated?.getTime() ?? 0
  const activeTimeouts = useMemo(
    () =>
      members.filter(
        (m) =>
          m.communication_disabled_until &&
          new Date(m.communication_disabled_until).getTime() > referenceTime,
      ).length,
    [members, referenceTime],
  )

  const updatedLabel = lastUpdated
    ? secondsAgo < 5 ? 'Just now' : `${secondsAgo}s ago`
    : null

  if (loading) {
    return (
      <div className="page-content">
        <PageHeader title="Moderation" helpId="moderation" description="Manage members, bans, and moderator activity for this server." />
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Moderation"
        helpId="moderation"
        description="Manage members, bans, and moderator activity for this server."
        action={
          <div className="flex items-center gap-3">
            {updatedLabel && (
              <span className="text-xs text-subtle">Updated {updatedLabel}</span>
            )}
            <button
              onClick={() => fetchData()}
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

      <BotPermsBanner perms={botPerms} resolved={botPermsResolved} guildId={guildId} />

      <div className="space-y-8">
        <CategorySection
          icon={<TrendingUp size={14} />}
          title="At a glance"
          description="Headline counts for moderation activity in this server."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              icon={<Users size={16} />}
              label="Members"
              value={members.length}
              color="#60a5fa"
            />
            <StatCard
              icon={<Shield size={16} />}
              label="In timeout"
              value={activeTimeouts}
              color="#f59e0b"
            />
            <StatCard
              icon={<Ban size={16} />}
              label="Active bans"
              value={bans.length}
              color="#ef4444"
            />
          </div>
        </CategorySection>

        <CategorySection
          icon={<Shield size={14} />}
          title="Manage"
          description="Members, active timeouts, the ban list, and full moderation log."
        >
          <div
            className="inline-flex rounded-lg border p-1"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
          >
            <TabButton active={tab === 'members'} onClick={() => setTab('members')} icon={<Users size={14} />}>
              Members
            </TabButton>
            <TabButton active={tab === 'timeouts'} onClick={() => setTab('timeouts')} icon={<Clock size={14} />}>
              Timeouts ({activeTimeouts})
            </TabButton>
            <TabButton active={tab === 'bans'} onClick={() => setTab('bans')} icon={<Ban size={14} />}>
              Bans ({bans.length})
            </TabButton>
            <TabButton active={tab === 'logs'} onClick={() => setTab('logs')} icon={<ScrollText size={14} />}>
              Logs
            </TabButton>
          </div>

          {tab === 'members' && (
            <MembersTab
              guildId={guildId}
              members={members}
              roles={roles}
              onActionComplete={bumpAfterAction}
            />
          )}
          {tab === 'timeouts' && (
            <TimeoutsTab
              guildId={guildId}
              members={members}
              meta={timeoutMeta}
              referenceTime={referenceTime}
              onActionComplete={bumpAfterAction}
            />
          )}
          {tab === 'bans' && (
            <BansTab
              guildId={guildId}
              bans={bans}
              onActionComplete={bumpAfterAction}
            />
          )}
          {tab === 'logs' && (
            <LogsTab guildId={guildId} refreshKey={logsRefreshKey} members={members} />
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

function BotPermsBanner({
  perms,
  resolved,
  guildId,
}: {
  perms: BotPermissions | null
  resolved: boolean
  guildId: string
}) {
  if (!resolved) return null
  const inviteHref = botInviteUrl(guildId)

  if (perms === null) {
    return (
      <div
        className="mb-6 flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between"
        style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
      >
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--text-3)' }} />
          <span>
            Couldn&apos;t verify the bot&apos;s permissions in this server. Actions will still be attempted —
            Discord will reject any that the bot can&apos;t perform.
          </span>
        </div>
        <a
          href={inviteHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border px-2.5 py-1 text-xs font-medium transition"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
        >
          Re-invite bot
        </a>
      </div>
    )
  }

  if (!perms.inGuild) {
    return (
      <div
        className="mb-6 flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
      >
        <span className="flex items-center gap-2">
          <AlertTriangle size={14} />
          Pulsify bot is not in this server. Moderation actions will fail until it&apos;s invited.
        </span>
        <a
          href={inviteHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition"
          style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}
        >
          Invite bot
        </a>
      </div>
    )
  }

  const required: { key: keyof BotPermissions; label: string }[] = [
    { key: 'banMembers', label: 'Ban Members' },
    { key: 'kickMembers', label: 'Kick Members' },
    { key: 'moderateMembers', label: 'Moderate Members (timeout)' },
    { key: 'manageNicknames', label: 'Manage Nicknames' },
    { key: 'manageRoles', label: 'Manage Roles' },
    { key: 'manageMessages', label: 'Manage Messages' },
    { key: 'viewAuditLog', label: 'View Audit Log' },
  ]
  const missing = required.filter((r) => !perms[r.key]).map((r) => r.label)

  // Healthy state — no banner; full permissions are the expected baseline.
  if (missing.length === 0) return null

  return (
    <div
      className="mb-6 flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between"
      style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>
          Bot is missing: <span className="font-semibold">{missing.join(', ')}</span>. Re-invite the bot or grant these in
          <span className="font-semibold"> Server Settings → Roles</span>.
        </span>
      </div>
      <a
        href={inviteHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border px-2.5 py-1 text-xs font-medium transition"
        style={{ borderColor: 'rgba(245,158,11,0.4)', color: '#f59e0b' }}
      >
        Re-invite bot
      </a>
    </div>
  )
}
