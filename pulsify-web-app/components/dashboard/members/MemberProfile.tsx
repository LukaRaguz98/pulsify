'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  ChevronLeft,
  Crown,
  Bot,
  Ban,
  Calendar,
  Clock,
  Copy,
  Check,
  MessageSquare,
  Mic,
  Terminal,
  Hash,
  Activity,
  ShieldAlert,
  Award,
  Users,
  AlertCircle,
  CheckCircle2,
  StickyNote,
  History,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { CategorySection } from '@/components/ui/category-section'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { ChartCard } from '@/components/dashboard/charts/ChartCard'
import { ToggleableChart } from '@/components/dashboard/charts/ToggleableChart'
import { RankedList } from '@/components/dashboard/RankedList'
import {
  avatarUrl,
  guildMemberAvatarUrl,
  roleColor,
} from '@/lib/discord'
import { formatDuration, formatHourLabel } from '@/lib/analytics'
import { createClient as createSupabase } from '@/lib/supabase'
import { computeReputation, daysSince, type Reputation } from '@/lib/reputation'
import { assignableRoleCount, memberRisk } from '@/lib/member-metrics'
import type { MemberProfileBundle } from '@/lib/member-profile'
import { ReputationBadge, RiskBadge } from '@/components/dashboard/members/badges'
import { ReputationPanel } from '@/components/dashboard/members/ReputationPanel'
import { ActivityHeatmap } from '@/components/dashboard/members/ActivityHeatmap'
import { ModerationHistory } from '@/components/dashboard/members/ModerationHistory'
import { ModerationNotes } from '@/components/dashboard/members/ModerationNotes'
import { MemberQuickActions } from '@/components/dashboard/members/MemberQuickActions'

type Props = { guildId: string; userId: string }

function formatAge(days: number): string {
  if (days >= 365) {
    const years = Math.floor(days / 365)
    const months = Math.floor((days % 365) / 30)
    return months > 0 ? `${years}y ${months}mo` : `${years}y`
  }
  if (days >= 30) return `${Math.floor(days / 30)}mo`
  return `${days}d`
}

function memberInTimeout(until: string | null | undefined): boolean {
  return !!until && new Date(until).getTime() > Date.now()
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
  return `${Math.floor(days / 30)}mo ago`
}

// Fill the last `days` days from sparse daily points so the timeline chart is
// continuous instead of connecting across gaps.
function fillDaily(daily: { day: string; messages: number; voice_seconds: number }[], days: number) {
  const byDay = new Map(daily.map((d) => [d.day, d]))
  const out: { day: string; messages: number; voice_seconds: number }[] = []
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  cursor.setDate(cursor.getDate() - (days - 1))
  for (let i = 0; i < days; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    const found = byDay.get(key)
    out.push({ day: key, messages: found?.messages ?? 0, voice_seconds: found?.voice_seconds ?? 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

export function MemberProfile({ guildId, userId }: Props) {
  const [bundle, setBundle] = useState<MemberProfileBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/discord/guild/${guildId}/members/${userId}/profile`, { cache: 'no-store' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Request failed (${res.status})`)
      }
      setBundle((await res.json()) as MemberProfileBundle)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load this profile.')
    } finally {
      setLoading(false)
    }
  }, [guildId, userId])

  useEffect(() => { load() }, [load])

  // Live updates: refetch when this member's moderation record or activity
  // changes, so warnings, reputation, history and notes reflect without a
  // manual refresh. Moderation events refetch near-instantly; high-volume
  // activity (messages/voice) is debounced so a chatty member doesn't spam.
  useEffect(() => {
    const supabase = createSupabase()
    let timer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = (delay: number) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        load()
      }, delay)
    }
    const channel = supabase
      .channel(`member-profile:${guildId}:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'moderation_logs', filter: `target_user_id=eq.${userId}` }, () => scheduleRefresh(400))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guild_warnings', filter: `user_id=eq.${userId}` }, () => scheduleRefresh(400))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'moderation_notes', filter: `user_id=eq.${userId}` }, () => scheduleRefresh(400))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'analytics_events', filter: `user_id=eq.${userId}` }, () => scheduleRefresh(4000))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'voice_sessions', filter: `user_id=eq.${userId}` }, () => scheduleRefresh(4000))
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [guildId, userId, load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const reputation: Reputation | null = useMemo(() => {
    if (!bundle) return null
    return computeReputation({
      accountAgeDays: daysSince(bundle.accountCreatedAt),
      tenureDays: daysSince(bundle.member.joined_at),
      messages: bundle.stats.message_count,
      voiceSeconds: bundle.stats.voice_seconds,
      commands: bundle.stats.command_count,
      activeChannels: bundle.stats.active_channels,
      assignableRoles: assignableRoleCount(bundle.member, bundle.roles),
      warnings: bundle.infractions.active_warnings,
      timeouts: bundle.infractions.timeouts,
      kicks: bundle.infractions.kicks,
      bans: bundle.infractions.bans,
    })
  }, [bundle])

  const backLink = `/dashboard/${guildId}/members`

  if (loading) {
    return (
      <div className="page-content">
        <Link href={backLink} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft size={16} /> Back to members
        </Link>
        <Skeleton className="mb-6 h-[180px]" />
        <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[112px]" />)}
        </div>
        <Skeleton className="h-[320px]" />
      </div>
    )
  }

  if (error || !bundle || !reputation) {
    return (
      <div className="page-content">
        <Link href={backLink} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft size={16} /> Back to members
        </Link>
        <EmptyState
          icon={<AlertCircle size={36} />}
          title="Couldn’t load this profile"
          description={error ?? 'This member is unavailable right now.'}
        />
      </div>
    )
  }

  const { member, roles, stats, infractions } = bundle
  const risk = memberRisk(infractions)
  const displayName = member.nick ?? member.user.global_name ?? member.user.username
  const av = member.avatar
    ? guildMemberAvatarUrl(guildId, member.user.id, member.avatar, 128)
    : avatarUrl(member.user.id, member.user.avatar, '0', 128)
  const inTimeout = memberInTimeout(member.communication_disabled_until)
  const accountAgeDays = daysSince(bundle.accountCreatedAt)
  const tenureDays = daysSince(member.joined_at)

  const memberRoles = roles
    .filter((r) => member.roles.includes(r.id) && r.name !== '@everyone')
    .sort((a, b) => b.position - a.position)

  const dailySeries = fillDaily(bundle.daily, 30)
  const hourlySeries = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    message_count: bundle.hourly.find((p) => p.hour === h)?.message_count ?? 0,
  }))
  const topChannels = bundle.topChannels.map((c) => ({
    id: c.channel_id,
    label: c.channel_name ? `#${c.channel_name}` : c.channel_id,
    value: c.message_count,
  }))

  function onActionComplete(label: string) {
    setToast({ kind: 'ok', text: label })
    load()
  }

  function copyId() {
    navigator.clipboard?.writeText(member.user.id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="page-content">
      <Link href={backLink} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground">
        <ChevronLeft size={16} /> Back to members
      </Link>

      {toast && (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: toast.kind === 'ok' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
            background: toast.kind === 'ok' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            color: toast.kind === 'ok' ? '#4ade80' : '#f87171',
          }}
        >
          {toast.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {toast.text}
        </div>
      )}

      {/* Header card */}
      <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
        {/* Banner: the member's Discord profile banner when set, otherwise
            their accent colour, otherwise a reputation-tinted gradient. */}
        <div
          className="relative h-32 w-full sm:h-40"
          style={{
            background:
              bundle.accentColor != null
                ? `#${bundle.accentColor.toString(16).padStart(6, '0')}`
                : `linear-gradient(110deg, color-mix(in srgb, ${reputation.color} 40%, var(--bg-2)), var(--bg-2))`,
          }}
        >
          {bundle.bannerUrl && (
            <Image src={bundle.bannerUrl} alt="" fill unoptimized sizes="100vw" className="object-cover" />
          )}
        </div>
        <div className="px-6 pb-6">
          {/* Avatar straddles the banner; name, badges and role sit fully below it. */}
          <Image
            src={av}
            alt={displayName}
            width={88}
            height={88}
            unoptimized
            className="relative -mt-12 rounded-2xl border-4"
            style={{ borderColor: 'var(--panel)', background: 'var(--bg-2)' }}
          />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-bold text-foreground">{displayName}</h1>
                {member.user.bot && (
                  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                    <Bot size={10} /> Bot
                  </span>
                )}
                {bundle.isOwner && (
                  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'rgba(245,158,11,0.14)', color: '#f59e0b' }}>
                    <Crown size={10} /> Owner
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-subtle">@{member.user.username}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ReputationBadge reputation={reputation} />
              <RiskBadge risk={risk} alwaysShow />
            </div>
          </div>

          {bundle.ban.banned && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
              <Ban size={14} />
              <span>This member is banned{bundle.ban.reason ? `: ${bundle.ban.reason}` : '.'}</span>
            </div>
          )}

          {/* Meta chips */}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-subtle">
            <span className="inline-flex items-center gap-1.5">
              <Calendar size={13} /> Joined {new Date(member.joined_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} · {formatAge(tenureDays)} ago
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock size={13} /> Account {bundle.accountCreatedAt ? `${formatAge(accountAgeDays)} old` : 'age unknown'}
            </span>
            {inTimeout && (
              <span className="inline-flex items-center gap-1.5" style={{ color: '#f59e0b' }}>
                <Clock size={13} /> In timeout until {new Date(member.communication_disabled_until!).toLocaleString('en-US')}
              </span>
            )}
            <button onClick={copyId} className="inline-flex items-center gap-1.5 font-mono transition hover:text-foreground" title="Copy user ID">
              {copied ? <Check size={13} /> : <Copy size={13} />} {member.user.id}
            </button>
          </div>

          {/* Quick actions */}
          {!member.user.bot && (
            <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--line-strong)' }}>
              <MemberQuickActions
                guildId={guildId}
                member={member}
                roles={roles}
                inTimeout={inTimeout}
                onActionComplete={onActionComplete}
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 space-y-8">
        {/* Overview cards */}
        <CategorySection icon={<Activity size={14} />} title="Overview" description="Lifetime activity and standing for this member.">
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatsCard label="Messages" value={stats.message_count} sub={`Last active ${relativeTime(stats.last_active)}`} icon={<MessageSquare size={16} />} accent="var(--p-1)" />
            <StatsCard label="Voice Time" value={formatDuration(stats.voice_seconds)} sub={`${stats.voice_sessions.toLocaleString()} sessions`} icon={<Mic size={16} />} accent="var(--cyan)" />
            <StatsCard label="Commands" value={stats.command_count} sub="Bot commands used" icon={<Terminal size={16} />} accent="var(--amber)" />
            <StatsCard label="Channels" value={stats.active_channels} sub="Channels posted in" icon={<Hash size={16} />} accent="#8b5cf6" />
            <StatsCard label="Reputation" value={reputation.score} sub={reputation.label} icon={<Award size={16} />} accent={reputation.color} />
            <StatsCard label="Infractions" value={infractions.total_infractions} sub={`${infractions.active_warnings} active warning${infractions.active_warnings === 1 ? '' : 's'}`} icon={<ShieldAlert size={16} />} accent="var(--red)" />
          </div>
        </CategorySection>

        {/* Reputation & roles */}
        <CategorySection icon={<Award size={14} />} title="Reputation & Trust" description="How this member's trust score breaks down, and their server roles.">
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ChartCard title="Trust score" subtitle="Computed from activity, tenure and moderation history" icon={<Award size={15} />}>
                <ReputationPanel reputation={reputation} risk={risk} />
              </ChartCard>
            </div>
            <ChartCard title="Roles" subtitle={`${memberRoles.length} role${memberRoles.length === 1 ? '' : 's'}`} icon={<Users size={15} />}>
              {memberRoles.length === 0 ? (
                <p className="py-2 text-sm text-subtle">No roles assigned.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {memberRoles.map((r) => (
                    <span key={r.id} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: roleColor(r.color) }} />
                      {r.name}
                    </span>
                  ))}
                </div>
              )}
            </ChartCard>
          </div>
        </CategorySection>

        {/* Activity */}
        <CategorySection icon={<Activity size={14} />} title="Activity" description="When and where this member is active.">
          <div className="grid gap-5 lg:grid-cols-2">
            <ToggleableChart
              title="Messages over time"
              subtitle="Messages sent per day (last 30 days)"
              icon={<MessageSquare size={15} />}
              defaultKind="line"
              data={dailySeries}
              xKey="day"
              series={[{ key: 'messages', name: 'Messages', color: 'var(--p-1)' }]}
              xTickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              tooltipLabelFormatter={(v) => new Date(v).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            />
            <ChartCard title="Activity heatmap" subtitle="Daily messages over the last 17 weeks" icon={<Activity size={15} />}>
              <ActivityHeatmap daily={bundle.daily} />
            </ChartCard>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <ToggleableChart
              title="Active hours"
              subtitle="Message volume by hour of day (UTC)"
              icon={<Clock size={15} />}
              defaultKind="bar"
              data={hourlySeries}
              xKey="hour"
              series={[{ key: 'message_count', name: 'Messages', color: 'var(--cyan)' }]}
              xTickFormatter={(v) => formatHourLabel(Number(v))}
            />
            <ChartCard title="Most active channels" subtitle="Where this member posts most" icon={<Hash size={15} />}>
              <RankedList items={topChannels} emptyText="No channel activity recorded yet." />
            </ChartCard>
          </div>
        </CategorySection>

        {/* Moderation */}
        <CategorySection icon={<ShieldAlert size={14} />} title="Moderation" description="Infraction history and private moderator notes.">
          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard title="History" subtitle="Warnings, timeouts, kicks and bans" icon={<History size={15} />}>
              <ModerationHistory warnings={bundle.warnings} modLogs={bundle.modLogs} />
            </ChartCard>
            <ChartCard title="Moderator notes" subtitle="Private — never shown to the member" icon={<StickyNote size={15} />}>
              <ModerationNotes guildId={guildId} userId={userId} notes={bundle.notes} onChanged={load} />
            </ChartCard>
          </div>
        </CategorySection>
      </div>
    </div>
  )
}
