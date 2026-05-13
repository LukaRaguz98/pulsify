import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildBans, avatarUrl } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { UnbanButton } from '@/components/dashboard/UnbanButton'
import { Shield, Ban } from 'lucide-react'
import Image from 'next/image'

export default async function ModerationPage({
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

  const [bans, { data: warnings }] = await Promise.all([
    fetchGuildBans(guildId),
    supabase
      .from('guild_warnings')
      .select('*')
      .eq('guild_id', guildId)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  return (
    <div className="page-content">
      <PageHeader
        title="Moderation"
        description="Overview of moderation actions and bans for this server."
      />

      <div className="grid gap-4 sm:grid-cols-2 mb-8">
        <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <div className="flex items-center gap-3 mb-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
              <Ban size={16} />
            </span>
            <span className="text-sm text-muted-foreground">Active Bans</span>
          </div>
          <p className="text-3xl font-bold text-foreground font-mono">{bans.length}</p>
        </div>
        <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <div className="flex items-center gap-3 mb-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
              <Shield size={16} />
            </span>
            <span className="text-sm text-muted-foreground">Active Warnings</span>
          </div>
          <p className="text-3xl font-bold text-foreground font-mono">{warnings?.length ?? 0}</p>
        </div>
      </div>

      {(warnings?.length ?? 0) > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-subtle">
            Recent Warnings
          </h2>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">Reason</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">Moderator</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">Date</th>
                </tr>
              </thead>
              <tbody>
                {warnings?.map((w) => (
                  <tr key={w.id} className="border-b" style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}>
                    <td className="px-4 py-3 text-foreground">{w.username ?? w.user_id}</td>
                    <td className="px-4 py-3 text-muted-foreground">{w.reason ?? '—'}</td>
                    <td className="px-4 py-3 text-subtle">{w.moderator_username ?? w.moderator_id}</td>
                    <td className="px-4 py-3 text-subtle text-xs font-mono">
                      {new Date(w.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-subtle">
          Ban List ({bans.length})
        </h2>
        {bans.length === 0 ? (
          <EmptyState
            icon={<Shield size={36} />}
            title="No active bans"
            description="This server has no banned users."
          />
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">Reason</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-subtle">Action</th>
                </tr>
              </thead>
              <tbody>
                {bans.map((ban) => {
                  const av = avatarUrl(ban.user.id, ban.user.avatar, ban.user.discriminator)
                  return (
                    <tr key={ban.user.id} className="border-b" style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {av ? (
                            <Image src={av} alt={ban.user.username} width={28} height={28} className="rounded-full shrink-0" unoptimized />
                          ) : (
                            <div className="h-7 w-7 rounded-full shrink-0" style={{ background: 'var(--bg-2)' }} />
                          )}
                          <div>
                            <p className="text-foreground">{ban.user.username}</p>
                            <p className="text-xs text-subtle font-mono">{ban.user.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{ban.reason ?? 'No reason provided'}</td>
                      <td className="px-4 py-3 text-right">
                        <UnbanButton
                          guildId={guildId}
                          userId={ban.user.id}
                          username={ban.user.username}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
