'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  Cake,
  CalendarDays,
  Settings,
  History,
  PartyPopper,
  Trash2,
  Coins,
  Sparkles,
  Gift,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { createClient as createSupabase } from '@/lib/supabase'
import { defaultAvatarUrl } from '@/lib/discord'
import {
  computeBirthdayStats,
  upcomingBirthdays,
  formatBirthday,
  countdownLabel,
  type BirthdayConfig,
  type MemberBirthday,
  type BirthdayEvent,
  type UpcomingBirthday,
} from '@/lib/birthdays'
import { BirthdayCalendar } from '@/components/dashboard/birthdays/BirthdayCalendar'
import { removeMemberBirthday } from '@/app/dashboard/[guildId]/birthdays/actions'

type Props = {
  guildId: string
  guildName: string
  initialConfig: BirthdayConfig
  initialBirthdays: MemberBirthday[]
  initialEvents: BirthdayEvent[]
  /** Discord avatar URL per user id, resolved server-side. */
  avatars: Record<string, string>
}

type Tab = 'overview' | 'history'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <CalendarDays size={15} /> },
  { id: 'history', label: 'History', icon: <History size={15} /> },
]

export function BirthdaysContent({
  guildId,
  guildName,
  initialConfig,
  initialBirthdays,
  initialEvents,
  avatars,
}: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [, startTransition] = useTransition()
  const [removing, setRemoving] = useState<MemberBirthday | null>(null)
  const [busy, setBusy] = useState(false)

  const guildTz = initialConfig.timezone

  // Members who left the guild have no avatar in the map — fall back to the
  // default avatar Discord would render for that id.
  const avatarFor = (userId: string) => avatars[userId] ?? defaultAvatarUrl(userId)

  // ?tab=history deep-link (opens once on mount).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab')
    if (t === 'history') {
      setTab(t)
      params.delete('tab')
      const qs = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    }
  }, [])

  // Realtime: refresh when members set birthdays or the bot records a celebration.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const supabase = createSupabase()
    const schedule = (ms: number) => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => startTransition(() => router.refresh()), ms)
    }
    const channel = supabase
      .channel(`birthdays:${guildId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_birthdays', filter: `guild_id=eq.${guildId}` }, () => schedule(800))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'birthday_events', filter: `guild_id=eq.${guildId}` }, () => schedule(1500))
      .subscribe()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [guildId, router])

  const stats = useMemo(
    () => computeBirthdayStats(initialBirthdays, initialEvents, { guildTimezone: guildTz }),
    [initialBirthdays, initialEvents, guildTz],
  )
  const upcoming = useMemo(
    () => upcomingBirthdays(initialBirthdays, { guildTimezone: guildTz }),
    [initialBirthdays, guildTz],
  )
  const today = useMemo(() => upcoming.filter((u) => u.isToday), [upcoming])
  const soon = useMemo(() => upcoming.filter((u) => !u.isToday).slice(0, 18), [upcoming])

  // Not enabled and nothing collected yet → the module has never been set up.
  const off = !initialConfig.enabled && initialBirthdays.length === 0

  // Page-header toolbar — same status pill + settings link every other module
  // uses (Private Channels, Security, Onboarding …).
  const settingsHref = `/dashboard/${guildId}/birthday-settings`
  const controls = (
    <div className="flex items-center gap-3">
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
        style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: initialConfig.enabled ? '#22c55e' : 'var(--text-3)' }} />
        {initialConfig.enabled ? 'Enabled' : 'Off'}
      </span>
      <Link
        href={settingsHref}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
        style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
      >
        <Settings size={12} />
        Birthday settings
      </Link>
    </div>
  )

  async function handleRemove() {
    if (!removing) return
    setBusy(true)
    await removeMemberBirthday(guildId, removing.user_id)
    setBusy(false)
    setRemoving(null)
    startTransition(() => router.refresh())
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Birthdays"
        helpId="birthdays"
        description={
          <>
            Celebrate members automatically in{' '}
            <span className="font-medium text-foreground">{guildName}</span>
          </>
        }
        action={controls}
      />

      {/* Page-level tabs — app-standard segmented control (matches Onboarding). */}
      <div className="mb-6 inline-flex flex-wrap rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors"
              style={active ? { background: 'var(--p-soft)', color: 'var(--text)' } : { color: 'var(--text-2)' }}
            >
              <span style={active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{t.icon}</span>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Off and nothing recorded yet → point the admin at Settings, the same
          empty state Private Channels uses before it's set up. */}
      {tab === 'overview' && off && (
        <EmptyState
          icon={<Cake size={26} />}
          title="Birthdays are off"
          description="Turn it on in Birthday settings — Pulse will announce birthdays in your chosen channel and hand out any rewards you configure."
          action={
            <Link
              href={settingsHref}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
            >
              <Settings size={15} /> Configure in settings
            </Link>
          }
        />
      )}

      {tab === 'overview' && !off && (
        <div className="space-y-8">
          <CategorySection icon={<Cake size={14} />} title="At a glance" description="Birthdays coming up and celebrations so far this year.">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard icon={<PartyPopper size={16} />} label="Today" value={stats.todayCount} accent="#f472b6" />
              <StatCard icon={<CalendarDays size={16} />} label="Next 7 days" value={stats.next7} accent="#a78bfa" />
              <StatCard icon={<Cake size={16} />} label="Birthdays set" value={stats.total} accent="#60a5fa" />
              <StatCard icon={<PartyPopper size={16} />} label="Celebrated this year" value={stats.celebratedThisYear} accent="#34d399" />
            </div>
          </CategorySection>

          {today.length > 0 && (
            <CategorySection icon={<PartyPopper size={14} />} title="Today’s birthdays" description="Members Pulse is celebrating today.">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {today.map((u) => (
                  <BirthdayCardView
                    key={u.birthday.user_id}
                    u={u}
                    avatar={avatarFor(u.birthday.user_id)}
                    onRemove={() => setRemoving(u.birthday)}
                    highlight
                  />
                ))}
              </div>
            </CategorySection>
          )}

          <CategorySection icon={<CalendarDays size={14} />} title="Upcoming & calendar" description="Who’s next, and the month at a glance.">
            <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
              <div>
                <h3 className="mb-3 text-sm font-semibold text-foreground">Upcoming</h3>
                {soon.length === 0 && today.length === 0 ? (
                  <EmptyState
                    icon={<Cake size={20} />}
                    title="No birthdays yet"
                    description="Members can set theirs with /birthday set or from their Pulsify profile."
                    variant="muted"
                  />
                ) : soon.length === 0 ? (
                  <p className="text-sm text-subtle">No more birthdays coming up — check back after today’s celebrations.</p>
                ) : (
                  <div className="space-y-2">
                    {soon.map((u) => (
                      <UpcomingRow
                        key={u.birthday.user_id}
                        u={u}
                        avatar={avatarFor(u.birthday.user_id)}
                        onRemove={() => setRemoving(u.birthday)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-foreground">Calendar</h3>
                <BirthdayCalendar birthdays={initialBirthdays} guildTz={guildTz} />
              </div>
            </div>
          </CategorySection>
        </div>
      )}

      {tab === 'history' && (
        <HistoryList events={initialEvents} avatarFor={avatarFor} />
      )}

      {removing && (
        <ConfirmDialog
          title="Remove this birthday?"
          description={`This removes ${removing.user_name ?? 'this member'}'s birthday from the server. They can set it again anytime.`}
          confirmLabel="Remove"
          tone="destructive"
          busy={busy}
          onConfirm={handleRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${accent}1f`, color: accent }}>
        {icon}
      </div>
      <p className="text-2xl font-semibold text-foreground">{value.toLocaleString()}</p>
      <p className="text-xs text-subtle">{label}</p>
    </div>
  )
}

function Avatar({ url, name }: { url: string; name: string | null }) {
  return (
    <Image
      src={url}
      alt={name ?? 'Member'}
      width={36}
      height={36}
      unoptimized
      className="h-9 w-9 shrink-0 rounded-full object-cover"
    />
  )
}

function BirthdayCardView({
  u,
  avatar,
  onRemove,
  highlight,
}: {
  u: UpcomingBirthday
  avatar: string
  onRemove: () => void
  highlight?: boolean
}) {
  const b = u.birthday
  return (
    <div
      className="group relative flex items-center gap-3 rounded-xl border p-4"
      style={{
        background: highlight ? 'rgba(244,114,182,0.08)' : 'var(--panel)',
        borderColor: highlight ? 'rgba(244,114,182,0.4)' : 'var(--line-strong)',
      }}
    >
      <Avatar url={avatar} name={b.user_name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{b.user_name ?? 'Unknown member'}</p>
        <p className="text-xs text-subtle">
          {formatBirthday(b.birth_month, b.birth_day, b.birth_year, b.show_year)}
          {u.age != null && b.show_year ? ` · turning ${u.age}` : ''}
        </p>
      </div>
      <span
        className="rounded-md px-2 py-0.5 text-[11px] font-medium"
        style={{ background: highlight ? 'rgba(244,114,182,0.2)' : 'var(--bg-2)', color: highlight ? '#f472b6' : 'var(--text-2)' }}
      >
        {countdownLabel(u.daysUntil)}
      </span>
      <button
        onClick={onRemove}
        className="absolute right-2 top-2 rounded-md p-1 text-subtle opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
        title="Remove birthday"
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

function UpcomingRow({ u, avatar, onRemove }: { u: UpcomingBirthday; avatar: string; onRemove: () => void }) {
  const b = u.birthday
  return (
    <div className="group flex items-center gap-3 rounded-lg border px-3 py-2.5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <Avatar url={avatar} name={b.user_name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{b.user_name ?? 'Unknown member'}</p>
        <p className="text-xs text-subtle">{formatBirthday(b.birth_month, b.birth_day, b.birth_year, b.show_year)}</p>
      </div>
      {!b.announce && <span className="rounded px-1.5 py-0.5 text-[10px] text-subtle" style={{ background: 'var(--bg-2)' }}>muted</span>}
      <span className="text-xs font-medium text-subtle">{countdownLabel(u.daysUntil)}</span>
      <button
        onClick={onRemove}
        className="rounded-md p-1 text-subtle opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
        title="Remove birthday"
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

function HistoryList({
  events,
  avatarFor,
}: {
  events: BirthdayEvent[]
  avatarFor: (userId: string) => string
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={<History size={20} />}
        title="No birthday history yet"
        description="Once Pulse celebrates a birthday, it shows up here with the rewards that were granted."
        variant="muted"
      />
    )
  }
  return (
    <div className="space-y-2">
      {events.map((e) => {
        const rewards = e.rewards ?? {}
        const coins = Number((rewards as Record<string, unknown>).coins ?? 0)
        const xp = Number((rewards as Record<string, unknown>).xp ?? 0)
        const rewardRoles = Array.isArray((rewards as Record<string, unknown>).roles)
          ? ((rewards as Record<string, unknown>).roles as string[])
          : []
        return (
          <div key={e.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <Avatar url={avatarFor(e.user_id)} name={e.user_name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {e.user_name ?? 'Unknown member'}
                {e.age != null && <span className="ml-1 text-xs font-normal text-subtle">turned {e.age}</span>}
              </p>
              <p className="text-xs text-subtle">
                {new Date(e.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                {e.announced ? ' · announced' : ' · not announced'}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {coins > 0 && <Chip icon={<Coins size={11} />} label={`${coins}`} />}
              {xp > 0 && <Chip icon={<Sparkles size={11} />} label={`${xp} XP`} />}
              {(e.role_id || rewardRoles.length > 0) && (
                <Chip icon={<Gift size={11} />} label={`${1 + rewardRoles.length} role${rewardRoles.length ? 's' : ''}`} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>
      {icon}
      {label}
    </span>
  )
}
