import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchUserGuilds, isBotInGuild, hasManageGuild, type DiscordGuild } from '@/lib/discord'
import { ServerCard } from '@/components/dashboard/ServerCard'
import { LogOut } from 'lucide-react'

type GuildWithBot = DiscordGuild & { botInstalled: boolean }

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/')

  const providerToken = session.provider_token
  let guilds: GuildWithBot[] = []
  let tokenMissing = false

  if (!providerToken) {
    tokenMissing = true
  } else {
    const all = await fetchUserGuilds(providerToken)
    const managed = all.filter((g) => hasManageGuild(g.permissions))
    guilds = await Promise.all(
      managed.map(async (g) => ({ ...g, botInstalled: await isBotInGuild(g.id) }))
    )
  }

  const user = session.user
  const displayName =
    user.user_metadata?.full_name ??
    user.user_metadata?.custom_claims?.global_name ??
    user.email ??
    'User'
  const userAvatar = user.user_metadata?.avatar_url ?? ''

  const active = guilds.filter((g) => g.botInstalled)
  const notConnected = guilds.filter((g) => !g.botInstalled)

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b sticky top-0 z-10" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', backdropFilter: 'blur(12px)' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="Pulsify"
              width={34}
              height={34}
              className="shrink-0"
              style={{ filter: 'drop-shadow(0 4px 10px var(--p-glow))' }}
            />
            <span className="font-bold text-base tracking-tight" style={{ color: 'var(--p-1)' }}>Pulsify</span>
          </div>

          <div className="flex items-center gap-3">
            {userAvatar ? (
              <Image src={userAvatar} alt={displayName} width={30} height={30} className="rounded-full" unoptimized />
            ) : (
              <div
                className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg, var(--cyan), var(--p-1))' }}
              >
                {displayName.charAt(0)}
              </div>
            )}
            <span className="text-sm text-muted-foreground hidden sm:block">{displayName}</span>
            <form action="/auth/logout" method="POST">
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-subtle hover:text-red-400 hover:bg-panel transition"
                style={{ '--panel': 'var(--bg-2)' } as React.CSSProperties}
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Welcome back, {displayName.split(' ')[0]}
          </h1>
          <p className="mt-1.5 text-muted-foreground">
            Select a Discord server to manage with Pulsify.
          </p>
        </div>

        {tokenMissing && (
          <div
            className="mb-8 rounded-xl p-5 border"
            style={{ background: 'rgba(245,158,11,0.07)', borderColor: 'rgba(245,158,11,0.25)' }}
          >
            <p className="font-medium text-amber-400">Session expired</p>
            <p className="mt-1 text-sm" style={{ color: 'rgba(245,158,11,0.7)' }}>
              Your Discord session has expired. Please{' '}
              <Link href="/" className="underline hover:text-amber-300">
                log in again
              </Link>{' '}
              to continue.
            </p>
          </div>
        )}

        {active.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-subtle">
              Active Servers ({active.length})
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((guild) => (
                <ServerCard key={guild.id} guild={guild} />
              ))}
            </div>
          </section>
        )}

        {notConnected.length > 0 && (
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-subtle">
              Not Connected ({notConnected.length})
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {notConnected.map((guild) => (
                <ServerCard key={guild.id} guild={guild} />
              ))}
            </div>
          </section>
        )}

        {!tokenMissing && guilds.length === 0 && (
          <div
            className="flex flex-col items-center justify-center rounded-xl border py-20 text-center"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            <p className="text-lg font-semibold text-foreground">No servers found</p>
            <p className="mt-2 text-sm text-subtle max-w-sm">
              You don&apos;t manage any Discord servers, or you need to grant server permissions.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
