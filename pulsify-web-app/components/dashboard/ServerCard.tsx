import Link from 'next/link'
import Image from 'next/image'
import { guildIconUrl, botInviteUrl, type DiscordGuild } from '@/lib/discord'

type Props = {
  guild: DiscordGuild & { botInstalled: boolean }
  /** The viewer is a regular member (no Manage Server) — the CTA opens the
   *  read-only member experience instead of "Manage". */
  memberAccess?: boolean
}

export function ServerCard({ guild, memberAccess = false }: Props) {
  const icon = guildIconUrl(guild.id, guild.icon, 128)
  const memberCount = guild.approximate_member_count ?? 0

  return (
    <div
      className="flex flex-col rounded-xl border border-border overflow-hidden transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--p-soft)] hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]"
      style={{ background: 'var(--panel)' }}
    >
      <div className="flex items-center gap-4 p-4">
        {icon ? (
          <Image src={icon} alt={guild.name} width={48} height={48} className="rounded-xl shrink-0" unoptimized />
        ) : (
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white font-bold text-lg"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
          >
            {guild.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground truncate">{guild.name}</p>
          <p className="text-sm text-subtle">
            {memberCount > 0 ? `${memberCount.toLocaleString()} members` : 'Members unknown'}
          </p>
        </div>
        <span
          className="text-xs px-2 py-1 rounded-full font-medium shrink-0"
          style={
            guild.botInstalled
              ? { background: 'rgba(16,185,129,0.12)', color: '#34d399' }
              : { background: 'var(--bg-2)', color: 'var(--text-3)' }
          }
        >
          {guild.botInstalled ? 'Active' : 'Not connected'}
        </span>
      </div>

      <div className="border-t px-4 py-3" style={{ borderColor: 'var(--line-strong)' }}>
        {guild.botInstalled ? (
          <Link
            href={`/dashboard/${guild.id}`}
            className="block w-full text-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all duration-150 hover:opacity-90 active:translate-y-px"
            style={{
              background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
              boxShadow: '0 4px 14px -4px var(--p-glow)',
            }}
          >
            {memberAccess ? 'View' : 'Manage'}
          </Link>
        ) : (
          <a
            href={botInviteUrl(guild.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center rounded-lg border px-4 py-2 text-sm font-medium transition-all duration-150 hover:bg-[var(--p-soft)]"
            style={{
              borderColor: 'var(--p-soft)',
              color: 'var(--p-1)',
            }}
          >
            Add Pulse Bot
          </a>
        )}
      </div>
    </div>
  )
}
