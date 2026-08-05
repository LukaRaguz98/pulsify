'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
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
  Sparkles,
  Globe,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { LeaderboardLink } from '@/components/dashboard/LeaderboardLink'
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
import { daysSince, type Reputation } from '@/lib/reputation'
import { progressInLevel } from '@/lib/leveling'
import { memberRisk } from '@/lib/member-metrics'
import type { MemberProfileBundle } from '@/lib/member-profile'
import { ReputationBadge, RiskBadge, LevelBadge, XpProgress } from '@/components/dashboard/members/badges'
import { ReputationPanel } from '@/components/dashboard/members/ReputationPanel'
import { ActivityHeatmap } from '@/components/dashboard/members/ActivityHeatmap'
import { ModerationHistory } from '@/components/dashboard/members/ModerationHistory'
import { ModerationNotes } from '@/components/dashboard/members/ModerationNotes'
import { MemberQuickActions } from '@/components/dashboard/members/MemberQuickActions'
import { MemberMilestones } from '@/components/dashboard/members/MemberMilestones'
import { MemberBirthdayCard } from '@/components/dashboard/members/MemberBirthdayCard'
import { GlobalPulseProfile } from '@/components/dashboard/members/GlobalPulseProfile'

type Props = {
  guildId: string
  userId: string
  /** 'member' renders the read-only, member-safe profile (no moderation,
   *  quick-actions, risk or infractions). Defaults to the full admin profile. */
  viewerRole?: 'admin' | 'member'
  /** Back-link target: `null` hides it (own profile), a string overrides the
   *  default admin Members/Moderation link, `undefined` uses the admin default. */
  backHref?: string | null
  backLabel?: string
  /** True when the signed-in viewer is looking at their OWN profile — unlocks
   *  the editable birthday card. */
  isSelf?: boolean
}

// Spelled-out age ("9 years and 1 month", "26 days") used for the joined/account
// lines on the profile card, where full words read clearer than a compact badge.
function formatAgeLong(days: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (days >= 365) {
    const years = Math.floor(days / 365)
    const months = Math.floor((days % 365) / 30)
    return months > 0
      ? `${plural(years, 'year')} and ${plural(months, 'month')}`
      : plural(years, 'year')
  }
  if (days >= 30) return plural(Math.floor(days / 30), 'month')
  return plural(days, 'day')
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

export function MemberProfile({ guildId, userId, viewerRole = 'admin', backHref, backLabel, isSelf = false }: Props) {
  const isAdmin = viewerRole === 'admin'
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
    let chan = supabase.channel(`member-profile:${guildId}:${userId}`)
    // Moderation realtime is ADMIN-ONLY: the websocket delivers the row payload
    // to the client (even though the callback only triggers a refetch), so a
    // member must not subscribe to moderation tables or it would leak that data.
    if (isAdmin) {
      chan = chan
        .on('postgres_changes', { event: '*', schema: 'public', table: 'moderation_logs', filter: `target_user_id=eq.${userId}` }, () => scheduleRefresh(400))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'guild_warnings', filter: `user_id=eq.${userId}` }, () => scheduleRefresh(400))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'moderation_notes', filter: `user_id=eq.${userId}` }, () => scheduleRefresh(400))
    }
    const channel = chan
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'analytics_events', filter: `user_id=eq.${userId}` }, () => scheduleRefresh(4000))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'voice_sessions', filter: `user_id=eq.${userId}` }, () => scheduleRefresh(4000))
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [guildId, userId, load, isAdmin])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // The member's GLOBAL reputation — the 0-100 trust score computed server-side
  // from activity aggregated across every Pulse server (PULSIFY-45). One
  // canonical reputation, shown here and in the Pulse Profile section below.
  const reputation: Reputation | null = bundle?.globalReputation ?? null

  const searchParams = useSearchParams()
  const from = searchParams.get('from')
  const defaultBackLink = from === 'moderation'
    ? `/dashboard/${guildId}/moderation`
    : `/dashboard/${guildId}/members`
  const defaultBackLabel = from === 'moderation' ? 'Back to Moderation' : 'Back to Members'
  const hideBack = backHref === null
  const resolvedBackHref = typeof backHref === 'string' ? backHref : defaultBackLink
  const resolvedBackLabel = backLabel ?? (typeof backHref === 'string' ? 'Back' : defaultBackLabel)
  const backButton = hideBack ? null : (
    <Link
      href={resolvedBackHref}
      className="mb-4 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
      style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
    >
      <ArrowLeft size={12} />
      {resolvedBackLabel}
    </Link>
  )

  // The standard page header (title + description + contextual-help ⓘ) every
  // other view carries; the back link above it acts as the parent breadcrumb.
  // Own profile (no back link) is phrased in the second person.
  const pageHeader = (
    <PageHeader
      title={hideBack ? 'Your profile' : 'Member profile'}
      helpId="profile"
      description={
        hideBack
          ? 'A full view of your activity, reputation, progression and standing.'
          : "A full view of this member's activity, reputation, progression and standing."
      }
    />
  )

  if (loading) {
    return (
      <div className="page-content">
        {backButton}
        {pageHeader}
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
        {backButton}
        {pageHeader}
        <EmptyState
          icon={<AlertCircle size={36} />}
          title="Couldn’t load this profile"
          description={error ?? 'This member is unavailable right now.'}
        />
      </div>
    )
  }

  const { member, roles, stats, infractions, isMember } = bundle
  const risk = memberRisk(infractions)
  const levelData = bundle.level ?? { xp: 0, level: 0 }
  const levelProgress = progressInLevel(levelData.xp, bundle.curve)
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
      {backButton}
      {pageHeader}

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
                {!isMember && (
                  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }} title="This user isn't a member of this server — showing their global Pulse profile">
                    <Globe size={10} /> Global profile
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-subtle">@{member.user.username}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ReputationBadge reputation={reputation} />
              {isAdmin && isMember && <RiskBadge risk={risk} alwaysShow />}
            </div>
          </div>

          {isAdmin && isMember && bundle.ban.banned && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
              <Ban size={14} />
              <span>This member is banned{bundle.ban.reason ? `: ${bundle.ban.reason}` : '.'}</span>
            </div>
          )}

          {/* Meta chips */}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-subtle">
            {isMember && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={13} /> Joined {new Date(member.joined_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} · {formatAgeLong(tenureDays)} ago
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Clock size={13} /> Account {bundle.accountCreatedAt ? `${formatAgeLong(accountAgeDays)} old` : 'age unknown'}
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

          {/* Quick actions — admin only, and only for actual members of this server */}
          {isAdmin && isMember && !member.user.bot && (
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
        {/* Global profile note — this user isn't a member here, so the
            server-specific sections (activity, server level, roles, moderation)
            don't apply and are omitted; their global standing is shown instead. */}
        {!isMember && (
          <div className="flex items-start gap-2.5 rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
            <Globe size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--p-1)' }} />
            <p className="text-muted-foreground">
              This user isn’t a member of this server. You’re viewing their <span className="font-medium text-foreground">global Pulse profile</span> — identity, reputation and cross-server standing. Server-specific activity, levels and roles aren’t available here.
            </p>
          </div>
        )}

        {/* Overview cards — server activity (members only) */}
        {isMember && (
        <CategorySection icon={<Activity size={14} />} title="Overview" description="Lifetime activity and standing for this member.">
          {/* 7 cards for admins (incl. Infractions), 6 for members — match the
              column count to the card count so the row fills the full width. */}
          <div className={`grid gap-4 sm:grid-cols-3 lg:grid-cols-4 ${isAdmin ? 'xl:grid-cols-7' : 'xl:grid-cols-6'}`}>
            <StatsCard label="Messages" value={stats.message_count} sub={`Last active ${relativeTime(stats.last_active)}`} icon={<MessageSquare size={16} />} accent="var(--p-1)" />
            <StatsCard label="Voice Time" value={formatDuration(stats.voice_seconds)} sub={`${stats.voice_sessions.toLocaleString()} sessions`} icon={<Mic size={16} />} accent="var(--cyan)" />
            <StatsCard label="Commands" value={stats.command_count} sub="Bot commands used" icon={<Terminal size={16} />} accent="var(--amber)" />
            <StatsCard label="Channels" value={stats.active_channels} sub="Channels posted in" icon={<Hash size={16} />} accent="#8b5cf6" />
            <StatsCard label="Level" value={levelProgress.level} sub={`${levelData.xp.toLocaleString()} XP total`} icon={<Sparkles size={16} />} accent="var(--p-1)" />
            <StatsCard label="Reputation" value={reputation.score} sub={reputation.label} icon={<Award size={16} />} accent={reputation.color} />
            {isAdmin && <StatsCard label="Infractions" value={infractions.total_infractions} sub={`${infractions.active_warnings} active warning${infractions.active_warnings === 1 ? '' : 's'}`} icon={<ShieldAlert size={16} />} accent="var(--red)" />}
          </div>
        </CategorySection>
        )}

        {/* Progression — level + XP earned from activity (members only) */}
        {isMember && (
        <CategorySection
          icon={<Sparkles size={14} />}
          title="Progression"
          description="Level and XP earned from this member's activity in the server."
          action={<LeaderboardLink guildId={guildId} board="level" label={isSelf ? 'See where you rank' : 'Level leaderboard'} />}
        >
          <ChartCard title="Level & XP" subtitle="Earned from messages, voice, commands, giveaways and events" icon={<Sparkles size={15} />}>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                  <span className="font-mono text-2xl font-bold tabular-nums">{levelProgress.level}</span>
                </div>
                <div>
                  <LevelBadge level={levelProgress.level} showTier />
                  <p className="mt-1.5 text-sm text-subtle">{levelData.xp.toLocaleString()} XP total</p>
                </div>
              </div>
              <div className="flex-1">
                <XpProgress xp={levelData.xp} curve={bundle.curve} />
                <p className="mt-2 text-xs text-subtle">
                  {levelProgress.toNext.toLocaleString()} XP to level {levelProgress.level + 1}
                </p>
              </div>
            </div>
          </ChartCard>
        </CategorySection>
        )}

        {/* Pulse Profile — server progression sits alongside the member's
            cross-server global standing (related data, one toggle). For
            non-members it opens straight to the global standing tab. */}
        <GlobalPulseProfile guildId={guildId} userId={userId} reputation={reputation} defaultTab={isMember ? 'server' : 'global'} />

        {/* Achievements — milestones this member has earned / is working toward
            (server-scoped; members only). */}
        {isMember && (
          <MemberMilestones
            guildId={guildId}
            userId={userId}
            base={{
              join_age_days: tenureDays,
              messages: stats.message_count,
              voice_minutes: Math.floor(stats.voice_seconds / 60),
              xp: levelData.xp,
              level: levelProgress.level,
            }}
          />
        )}

        {/* Birthday — members can set/manage their own; others see it read-only
            (respecting the member's privacy choices). */}
        {isMember && (
          <MemberBirthdayCard guildId={guildId} userId={userId} isSelf={isSelf} />
        )}

        {/* Reputation & trust — the trust score is GLOBAL, so it shows for
            everyone; the roles card is server-specific (members only). */}
        <CategorySection icon={<Award size={14} />} title="Reputation & Trust" helpId="reputation" description={isMember ? "How this member's trust score breaks down, and their server roles." : "How this user's global trust score breaks down."}>
          <div className={`grid gap-5 ${isMember ? 'lg:grid-cols-3' : ''}`}>
            <div className={isMember ? 'lg:col-span-2' : ''}>
              <ChartCard title="Trust score" subtitle="Computed from activity, tenure and moderation history across every Pulse server" icon={<Award size={15} />}>
                <ReputationPanel reputation={reputation} risk={risk} />
              </ChartCard>
            </div>
            {isMember && (
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
            )}
          </div>
        </CategorySection>

        {/* Activity — server-scoped (members only) */}
        {isMember && (
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
        )}

        {/* Moderation — admin only, and only for members of this server */}
        {isAdmin && isMember && (
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
        )}
      </div>
    </div>
  )
}
