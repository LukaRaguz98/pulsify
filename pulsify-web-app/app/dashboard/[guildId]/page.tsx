import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import {
  fetchGuild,
  fetchGuildChannels,
  fetchGuildRoles,
} from '@/lib/discord'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { Users, Hash, Crown, Wifi } from 'lucide-react'

export default async function GuildAnalyticsPage({
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
  const visibleRoles = roles
    .filter((r) => r.name !== '@everyone')
    .sort((a, b) => b.position - a.position)

  const onlineCount = guild.approximate_presence_count ?? 0
  const totalCount = guild.approximate_member_count ?? guild.member_count ?? 0

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Analytics Overview</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Real-time data for <span className="text-foreground font-medium">{guild.name}</span>
        </p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          sub={totalCount > 0 ? `${Math.round((onlineCount / totalCount) * 100)}% of members` : '—'}
          icon={<Wifi size={16} />}
          accent="#10b981"
        />
        <StatsCard
          label="Text Channels"
          value={textChannels.length}
          sub={`${voiceChannels.length} voice · ${categories.length} categories`}
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

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Top Roles */}
        <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
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
                      className="h-3 w-3 rounded-full shrink-0 border"
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
                      <span className="rounded px-1.5 py-0.5" style={{ background: 'var(--bg-2)' }}>Hoisted</span>
                    )}
                    {role.managed && (
                      <span className="rounded px-1.5 py-0.5" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>Managed</span>
                    )}
                  </div>
                </li>
              ))}
              {visibleRoles.length > 10 && (
                <li className="text-xs text-subtle">+{visibleRoles.length - 10} more roles</li>
              )}
            </ul>
          )}
        </div>

        {/* Channels */}
        <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-subtle">
            Channels
          </h2>
          <div className="space-y-4">
            {[
              { label: 'Text channels', count: textChannels.length, color: '#3b82f6' },
              { label: 'Voice channels', count: voiceChannels.length, color: '#10b981' },
              { label: 'Categories', count: categories.length, color: '#f59e0b' },
              {
                label: 'Other',
                count: channels.length - textChannels.length - voiceChannels.length - categories.length,
                color: '#6b6d82',
              },
            ].map(({ label, count, color }) => (
              <div key={label}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-foreground font-medium font-mono">{count}</span>
                </div>
                <div className="h-1.5 w-full rounded-full" style={{ background: 'var(--bg-2)' }}>
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: channels.length > 0 ? `${(count / channels.length) * 100}%` : '0%',
                      background: color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {guild.description && (
          <div className="rounded-xl border p-5 lg:col-span-2" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-subtle">
              Server Description
            </h2>
            <p className="text-muted-foreground">{guild.description}</p>
          </div>
        )}
      </div>
    </div>
  )
}
