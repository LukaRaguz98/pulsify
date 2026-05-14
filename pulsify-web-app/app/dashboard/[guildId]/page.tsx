import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles } from '@/lib/discord'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { Users, Wifi, Hash, Crown, Activity, LayoutGrid, FolderTree } from 'lucide-react'

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
