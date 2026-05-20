import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles, snowflakeToDate } from '@/lib/discord'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { Users, Wifi, Hash, Crown, Activity, LayoutGrid, FolderTree, Sparkles, ShieldCheck, CalendarDays } from 'lucide-react'

const VERIFICATION_LABELS = ['None', 'Low', 'Medium', 'High', 'Very High'] as const

// Boosts required to *reach* the next tier from the current one (null = maxed).
const BOOST_NEXT_THRESHOLD: Record<number, number | null> = { 0: 2, 1: 7, 2: 14, 3: null }

// Headline perks unlocked at each Discord boost tier — shown when hovering the
// tier badge so admins see what their boosters get.
const BOOST_TIER_PERKS: Record<1 | 2 | 3, string[]> = {
  1: [
    '100 custom emoji slots',
    '128 Kbps audio quality',
    'Animated server icon & custom invite background',
    'Stream in 720p 60fps',
  ],
  2: [
    '150 emoji slots & 256 Kbps audio',
    'Custom server banner',
    '50 MB uploads for every member',
    '1080p 60fps streaming & role icons',
  ],
  3: [
    '250 emoji slots & 384 Kbps audio',
    'Animated banner & vanity invite URL',
    '100 MB uploads for every member',
  ],
}

// Discord guild feature flags → friendly labels. Only the ones worth surfacing.
const FEATURE_LABELS: Record<string, string> = {
  COMMUNITY: 'Community',
  VERIFIED: 'Verified',
  PARTNERED: 'Partnered',
  DISCOVERABLE: 'Discoverable',
  VANITY_URL: 'Vanity URL',
  ANIMATED_ICON: 'Animated Icon',
  BANNER: 'Banner',
  INVITE_SPLASH: 'Invite Splash',
  WELCOME_SCREEN_ENABLED: 'Welcome Screen',
  NEWS: 'Announcements',
}

/** Friendly "age since creation" string, e.g. "4y 2mo old". */
function formatServerAge(date: Date): string {
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  if (years > 0) return `${years}y ${months}mo old`
  if (months > 0) return `${months}mo old`
  return `${days}d old`
}

export default async function GuildOverviewPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const [guild, channels, roles] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
  ])

  if (!guild) redirect('/dashboard')

  const textChannels = channels.filter((c) => c.type === 0)
  const voiceChannels = channels.filter((c) => c.type === 2)
  const categories = channels.filter((c) => c.type === 4)
  const otherCount =
    channels.length - textChannels.length - voiceChannels.length - categories.length
  const visibleRoles = roles
    .filter((r) => r.name !== '@everyone')
    .sort((a, b) => b.position - a.position)

  const onlineCount = guild.approximate_presence_count ?? 0
  const totalCount = guild.approximate_member_count ?? guild.member_count ?? 0
  const onlineRate = totalCount > 0 ? Math.round((onlineCount / totalCount) * 100) : 0

  const boostTier = guild.premium_tier ?? 0
  const boostCount = guild.premium_subscription_count ?? 0
  const boostNext = BOOST_NEXT_THRESHOLD[boostTier] ?? null
  const boostProgress = boostNext ? Math.min(100, Math.round((boostCount / boostNext) * 100)) : 100
  const boostsToNext = boostNext ? Math.max(0, boostNext - boostCount) : 0
  // When no tier yet, the badge previews what Tier 1 will unlock.
  const tooltipTier = (boostTier === 0 ? 1 : boostTier) as 1 | 2 | 3
  const tierPerks = BOOST_TIER_PERKS[tooltipTier]
  const tierPerksLabel = boostTier === 0 ? 'Tier 1 unlocks' : `Tier ${boostTier} perks`

  const createdAt = snowflakeToDate(guild.id)
  const verificationLabel = VERIFICATION_LABELS[guild.verification_level ?? 0] ?? 'None'
  const featureBadges = (guild.features ?? [])
    .map((f) => FEATURE_LABELS[f])
    .filter((v): v is string => Boolean(v))
    .slice(0, 6)

  return (
    <div className="page-content">
      <PageHeader
        title="Server Overview"
        description={
          <>
            Current snapshot of{' '}
            <span className="font-medium text-foreground">{guild.name}</span>
          </>
        }
        action={
          <Link
            href={`/dashboard/${guildId}/statistics`}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
          >
            <Activity size={12} />
            View Statistics
          </Link>
        }
      />

      <div className="space-y-8">
        {/* ── At a Glance ──────────────────────────────────────────────── */}
        <CategorySection
          icon={<LayoutGrid size={14} />}
          title="At a Glance"
          description="Live counts for members, channels and roles."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              label="Total Members"
              value={totalCount}
              sub="All server members"
              icon={<Users size={16} />}
              accent="var(--p-1)"
            />
            <StatsCard
              label="Online Now"
              value={onlineCount}
              sub={totalCount > 0 ? `${onlineRate}% of members` : '—'}
              icon={<Wifi size={16} />}
              accent="#10b981"
            />
            <StatsCard
              label="Channels"
              value={channels.length}
              sub={`${textChannels.length} text · ${voiceChannels.length} voice`}
              icon={<Hash size={16} />}
              accent="#22d3ee"
            />
            <StatsCard
              label="Roles"
              value={visibleRoles.length}
              sub="Excluding @everyone"
              icon={<Crown size={16} />}
              accent="#f59e0b"
            />
          </div>
        </CategorySection>

        {/* ── Server Highlights ────────────────────────────────────────── */}
        <CategorySection
          icon={<Sparkles size={14} />}
          title="Server Highlights"
          description="Boost progress and key facts about your server."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Boost progress */}
            <div
              className="rounded-xl border p-5"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
            >
              {/* z-30 lifts the header (and the tier badge's tooltip) above the
                  progress bar — every element is its own stacking context
                  (globals.css `* { position: relative; z-index: 1 }`), so the
                  later progress-bar sibling would otherwise paint over it. */}
              <div className="relative z-30 mb-4 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-subtle">
                  Server Boosts
                </h2>
                <span
                  tabIndex={0}
                  className="group relative flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium outline-none"
                  style={{ background: 'rgba(255,115,250,0.12)', color: '#ff8af5' }}
                >
                  <Sparkles size={11} />
                  {boostTier > 0 ? `Tier ${boostTier}` : 'No tier'}

                  {/* Perks tooltip — appears on hover / keyboard focus. High
                      z-index so it sits above the boost progress bar below. */}
                  <span
                    className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-60 rounded-lg border p-3 text-left shadow-xl group-hover:block group-focus:block"
                    style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
                  >
                    <span
                      className="mb-2 block text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: '#ff8af5' }}
                    >
                      {tierPerksLabel}
                    </span>
                    <span className="flex flex-col gap-1.5">
                      {tierPerks.map((perk) => (
                        <span key={perk} className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--text-2)' }}>
                          <Sparkles size={10} className="mt-0.5 shrink-0" style={{ color: '#ff8af5' }} />
                          <span>{perk}</span>
                        </span>
                      ))}
                    </span>
                  </span>
                </span>
              </div>

              <div className="mb-2 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-foreground">{boostCount}</span>
                <span className="text-sm text-subtle">boost{boostCount === 1 ? '' : 's'}</span>
              </div>

              <div className="h-2.5 w-full rounded-full" style={{ background: 'var(--bg-2)' }}>
                <div
                  className="h-2.5 rounded-full transition-all"
                  style={{
                    width: `${boostProgress}%`,
                    background: 'linear-gradient(90deg, #ff73fa, #c576ff)',
                    boxShadow: '0 0 12px -2px rgba(255,115,250,0.55)',
                  }}
                />
              </div>

              <p className="mt-2 text-xs text-subtle">
                {boostNext
                  ? `${boostsToNext} more boost${boostsToNext === 1 ? '' : 's'} to reach Tier ${boostTier + 1}`
                  : 'Maximum boost tier reached 🎉'}
              </p>
            </div>

            {/* Server details */}
            <div
              className="rounded-xl border p-5"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
            >
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-subtle">
                Server Details
              </h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <CalendarDays size={14} className="text-subtle" />
                    Created
                  </span>
                  <span className="text-right font-medium text-foreground">
                    {createdAt
                      ? createdAt.toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : 'Unknown'}
                    {createdAt && (
                      <span className="ml-1.5 text-xs font-normal text-subtle">
                        · {formatServerAge(createdAt)}
                      </span>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <ShieldCheck size={14} className="text-subtle" />
                    Verification
                  </span>
                  <span className="font-medium text-foreground">{verificationLabel}</span>
                </div>

                {featureBadges.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {featureBadges.map((label) => (
                      <span
                        key={label}
                        className="rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </CategorySection>

        {/* ── Roles & Structure ────────────────────────────────────────── */}
        <CategorySection
          icon={<FolderTree size={14} />}
          title="Roles & Structure"
          description="How your server is organised across roles and channels."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Top Roles */}
            <div
              className="rounded-xl border p-5"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
            >
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-subtle">
                Top Roles
              </h2>
              {visibleRoles.length === 0 ? (
                <p className="text-sm text-subtle">No roles found.</p>
              ) : (
                <ul className="space-y-2">
                  {visibleRoles.slice(0, 10).map((role) => (
                    <li key={role.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border"
                          style={{
                            backgroundColor:
                              role.color !== 0
                                ? `#${role.color.toString(16).padStart(6, '0')}`
                                : '#6b6d82',
                            borderColor: 'var(--line-strong)',
                          }}
                        />
                        <span className="text-sm text-muted-foreground">{role.name}</span>
                      </div>
                      <div className="flex gap-1.5 text-xs text-subtle">
                        {role.hoist && (
                          <span
                            className="rounded px-1.5 py-0.5"
                            style={{ background: 'var(--bg-2)' }}
                          >
                            Hoisted
                          </span>
                        )}
                        {role.managed && (
                          <span
                            className="rounded px-1.5 py-0.5"
                            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
                          >
                            Managed
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                  {visibleRoles.length > 10 && (
                    <li className="text-xs text-subtle">
                      +{visibleRoles.length - 10} more roles
                    </li>
                  )}
                </ul>
              )}
            </div>

            {/* Server Structure */}
            <div
              className="rounded-xl border p-5"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
            >
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-subtle">
                Channel Structure
              </h2>
              <div className="space-y-4">
                {[
                  { label: 'Text channels', count: textChannels.length, color: '#3b82f6' },
                  { label: 'Voice channels', count: voiceChannels.length, color: '#10b981' },
                  { label: 'Categories', count: categories.length, color: '#f59e0b' },
                  { label: 'Other', count: otherCount, color: '#6b6d82' },
                ].map(({ label, count, color }) => (
                  <div key={label}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono font-medium text-foreground">{count}</span>
                    </div>
                    <div
                      className="h-1.5 w-full rounded-full"
                      style={{ background: 'var(--bg-2)' }}
                    >
                      <div
                        className="h-1.5 rounded-full transition-all"
                        style={{
                          width:
                            channels.length > 0
                              ? `${(count / channels.length) * 100}%`
                              : '0%',
                          background: color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {guild.description && (
              <div
                className="rounded-xl border p-5 lg:col-span-2"
                style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
              >
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-subtle">
                  Server Description
                </h2>
                <p className="text-muted-foreground">{guild.description}</p>
              </div>
            )}
          </div>
        </CategorySection>
      </div>
    </div>
  )
}
