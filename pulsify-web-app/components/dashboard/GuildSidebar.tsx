'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { guildIconUrl, type DiscordGuildFull } from '@/lib/discord'
import {
  BarChart2,
  CalendarDays,
  Zap,
  Shield,
  Users,
  ChevronLeft,
  LogOut,
  Settings,
  MoreHorizontal,
} from 'lucide-react'

type NavItem = {
  label: string
  href: string
  icon: React.ReactNode
}

type NavGroup = {
  title: string | null
  items: NavItem[]
}

type Props = {
  guild: DiscordGuildFull
  guildId: string
  user: {
    id: string
    user_metadata?: {
      full_name?: string
      avatar_url?: string
      custom_claims?: { global_name?: string }
    }
  }
}

export function GuildSidebar({ guild, guildId, user }: Props) {
  const pathname = usePathname()
  const base = `/dashboard/${guildId}`

  const groups: NavGroup[] = [
    {
      title: 'Analytics',
      items: [
        { label: 'Overview', href: base, icon: <BarChart2 size={16} /> },
      ],
    },
    {
      title: 'Manage',
      items: [
        { label: 'Events', href: `${base}/events`, icon: <CalendarDays size={16} /> },
        { label: 'Automations', href: `${base}/automations`, icon: <Zap size={16} /> },
        { label: 'Moderation', href: `${base}/moderation`, icon: <Shield size={16} /> },
        { label: 'Roles', href: `${base}/roles`, icon: <Users size={16} /> },
      ],
    },
    {
      title: 'Settings',
      items: [
        { label: 'Preferences', href: `${base}/settings`, icon: <Settings size={16} /> },
      ],
    },
  ]

  const icon = guildIconUrl(guild.id, guild.icon, 64)
  const displayName =
    user.user_metadata?.full_name ??
    user.user_metadata?.custom_claims?.global_name ??
    'User'
  const userAvatar = user.user_metadata?.avatar_url ?? ''
  const memberCount = guild.approximate_member_count ?? guild.member_count

  return (
    <aside
      className="flex h-full w-[230px] shrink-0 flex-col border-r overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, var(--bg-2) 0%, var(--bg) 100%)',
        borderColor: 'var(--line-strong)',
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b" style={{ borderColor: 'var(--line-strong)' }}>
        <Image
          src="/logo.png"
          alt="Pulsify"
          width={28}
          height={28}
          className="shrink-0"
          style={{ filter: 'drop-shadow(0 4px 10px var(--p-glow))' }}
        />
        <span className="font-bold text-base tracking-tight text-foreground">Pulsify</span>
      </div>

      {/* Server card */}
      <div className="mx-3 my-3 flex items-center gap-2.5 rounded-xl p-2.5 cursor-pointer border" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        {icon ? (
          <Image src={icon} alt={guild.name} width={30} height={30} className="rounded-lg shrink-0" unoptimized />
        ) : (
          <div
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg shrink-0 font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
          >
            {guild.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{guild.name}</p>
          {memberCount && (
            <p className="text-xs text-subtle">{memberCount.toLocaleString()} members</p>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-4">
        {groups.map((group) => (
          <div key={group.title}>
            {group.title && (
              <p className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-widest text-subtle">
                {group.title}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = item.href === base
                  ? pathname === base
                  : pathname.startsWith(item.href)

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all relative"
                    style={
                      isActive
                        ? {
                            background: 'linear-gradient(90deg, var(--p-soft), transparent)',
                            color: 'var(--text)',
                            boxShadow: 'inset 0 0 0 1px var(--p-soft)',
                          }
                        : {
                            color: 'var(--text-2)',
                          }
                    }
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = 'var(--panel)'
                        e.currentTarget.style.color = 'var(--text)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = ''
                        e.currentTarget.style.color = 'var(--text-2)'
                      }
                    }}
                  >
                    {isActive && (
                      <span
                        className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r"
                        style={{ background: 'var(--p-1)', boxShadow: '0 0 10px var(--p-glow)' }}
                      />
                    )}
                    <span style={isActive ? { color: 'var(--p-1)' } : {}}>{item.icon}</span>
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="border-t p-2 space-y-0.5" style={{ borderColor: 'var(--line-strong)' }}>
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground transition"
          style={{ '--tw-bg-opacity': '1' } as React.CSSProperties}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
        >
          <ChevronLeft size={16} />
          All Servers
        </Link>

        <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
          {userAvatar ? (
            <Image src={userAvatar} alt={displayName} width={26} height={26} className="rounded-full shrink-0" unoptimized />
          ) : (
            <div
              className="flex h-[26px] w-[26px] items-center justify-center rounded-full shrink-0 text-xs text-white font-bold"
              style={{ background: 'linear-gradient(135deg, var(--cyan), var(--p-1))' }}
            >
              {displayName.charAt(0)}
            </div>
          )}
          <span className="flex-1 truncate text-sm text-muted-foreground">{displayName}</span>
          <form action="/auth/logout" method="POST" className="shrink-0">
            <button
              type="submit"
              title="Log out"
              className="text-subtle hover:text-red-400 transition p-1 rounded"
            >
              <LogOut size={14} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  )
}
