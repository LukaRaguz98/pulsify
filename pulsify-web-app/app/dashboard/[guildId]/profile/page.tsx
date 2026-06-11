import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, CalendarDays, Globe, Sparkles, Star, Trophy } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { getGuildAccess } from '@/lib/guild-access'
import { getGlobalReputationBundle } from '@/lib/economy-server'
import { fetchGuild, fetchGuildMember, avatarUrl } from '@/lib/discord'
import { normaliseLevelingSettings, progressInLevel } from '@/lib/leveling'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { ReputationBadge, LevelBadge } from '@/components/dashboard/members/badges'
import { GlobalPulseProfile } from '@/components/dashboard/members/GlobalPulseProfile'

/**
 * The member-facing Profile — the home page of the member experience
 * (PULSIFY-45 member access). Shows the viewer's OWN standing only: their
 * server progression (local level & XP), their global reputation, and the
 * cross-server Pulse Profile. Read-only by construction; admins keep the full
 * member directory under Members.
 */
export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  const supabase = await createClient()
  const [guild, member, levelRes, settingsRes, repBundle] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildMember(guildId, access.userId),
    supabase
      .from('member_levels')
      .select('xp, level')
      .eq('guild_id', guildId)
      .eq('user_id', access.userId)
      .maybeSingle(),
    supabase.from('leveling_settings').select('enabled, settings').eq('guild_id', guildId).maybeSingle(),
    getGlobalReputationBundle(access.userId),
  ])
  if (!guild) redirect('/dashboard')

  const curve = normaliseLevelingSettings(settingsRes.data ?? null).curve
  const xp = Number(levelRes.data?.xp ?? 0)
  const progress = progressInLevel(xp, curve)
  const name =
    member?.nick ?? member?.user.global_name ?? member?.user.username ?? 'You'
  const avatar = member ? avatarUrl(member.user.id, member.user.avatar, '0', 128) : null
  const joined = member?.joined_at
    ? new Date(member.joined_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  return (
    <div className="page-content">
      <PageHeader
        title="Your Profile"
        description={
          <>
            Your standing in <span className="font-medium text-foreground">{guild.name}</span> and
            across the Pulse network
          </>
        }
      />

      <div className="space-y-8">
        {/* Identity */}
        <div
          className="flex flex-wrap items-center gap-4 rounded-xl border p-5"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          {avatar && (
            <Image src={avatar} alt={name} width={56} height={56} unoptimized className="rounded-full" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-foreground">{name}</p>
            {joined && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle">
                <CalendarDays size={12} />
                Member since {joined}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <LevelBadge level={progress.level} />
            <ReputationBadge reputation={repBundle.reputation} />
          </div>
        </div>

        {/* Server progression — local by design. */}
        <CategorySection
          icon={<Trophy size={14} />}
          title="Server progression"
          description={`Level and XP are specific to ${guild.name} — every server has its own ladder.`}
        >
          <div
            className="rounded-xl border p-5"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                <Sparkles size={13} className="mr-1.5 inline" style={{ color: 'var(--p-1)' }} />
                Level {progress.level}
              </p>
              <p className="font-mono text-xs text-subtle">
                {progress.intoLevel.toLocaleString()} / {progress.span.toLocaleString()} XP ·{' '}
                {progress.toNext.toLocaleString()} to level {progress.level + 1}
              </p>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
              <div
                className="h-2.5 rounded-full transition-all"
                style={{ width: `${progress.pct}%`, background: 'linear-gradient(90deg, var(--p-1), var(--p-2))' }}
              />
            </div>
            <p className="mt-3 text-xs text-subtle">
              {xp.toLocaleString()} XP earned in this server — see where you rank on the{' '}
              <Link href={`/dashboard/${guildId}/leaderboard`} className="font-medium" style={{ color: 'var(--p-1)' }}>
                leaderboards
              </Link>
              .
            </p>
          </div>
        </CategorySection>

        {/* Global reputation teaser → full breakdown on /reputation. */}
        <CategorySection
          icon={<Star size={14} />}
          title="Global reputation"
          description="Your 0–100 trust score, computed from your activity across every Pulse server."
        >
          <Link
            href={`/dashboard/${guildId}/reputation`}
            className="flex items-center gap-4 rounded-xl border p-5 transition hover:border-[var(--p-1)]"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            <span
              className="font-mono text-3xl font-bold tabular-nums"
              style={{ color: repBundle.reputation.color }}
            >
              {repBundle.reputation.score}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{repBundle.reputation.label}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle">
                <Globe size={12} />
                Global — shared across every server running Pulse
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--p-1)' }}>
              How it&apos;s calculated <ArrowRight size={13} />
            </span>
          </Link>
        </CategorySection>

        {/* Cross-server identity: wallet, ranks, per-server levels. */}
        <GlobalPulseProfile
          guildId={guildId}
          userId={access.userId}
          reputation={repBundle.reputation}
        />
      </div>
    </div>
  )
}
