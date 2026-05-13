import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildBans, avatarUrl } from '@/lib/discord'
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
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Moderation</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Overview of moderation actions and bans for this server.
        </p>
      </div>

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
                  <tr key={w.id} className="border-b" style={{ borderColor: 'var(--line-strong)', background: 'rgba(20,21,31,0.5)' }}>
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
          <div className="flex flex-col items-center justify-center rounded-xl border py-16 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <Shield size={36} className="mb-3 text-subtle" />
            <p className="font-semibold text-foreground">No active bans</p>
            <p className="mt-1 text-sm text-subtle">This server has no banned users.</p>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">Reason</th>
                </tr>
              </thead>
              <tbody>
                {bans.map((ban) => {
                  const av = avatarUrl(ban.user.id, ban.user.avatar, ban.user.discriminator)
                  return (
                    <tr key={ban.user.id} className="border-b" style={{ borderColor: 'var(--line-strong)', background: 'rgba(20,21,31,0.5)' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {av ? (
                            <Image src={av} alt={ban.user.username} width={28} height={28} className="rounded-full" unoptimized />
                          ) : (
                            <div className="h-7 w-7 rounded-full" style={{ background: 'var(--bg-2)' }} />
                          )}
                          <div>
                            <p className="text-foreground">{ban.user.username}</p>
                            <p className="text-xs text-subtle font-mono">{ban.user.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{ban.reason ?? 'No reason provided'}</td>
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
