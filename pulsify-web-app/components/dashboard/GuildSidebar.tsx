'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { guildIconUrl, type DiscordGuildFull, type DiscordSelfUser } from '@/lib/discord'
import {
  BarChart2,
  Activity,
  CalendarDays,
  Zap,
  Shield,
  Users,
  ChevronLeft,
  ChevronRight,
  Settings,
} from 'lucide-react'
import { UserProfileButton } from '@/components/dashboard/UserProfileButton'

type NavItem = {
  label: string
  href: string
  icon: React.ReactNode
  badge?: string
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
    email?: string
    user_metadata?: {
      full_name?: string
      avatar_url?: string
      provider_id?: string
      custom_claims?: {
        global_name?: string
        username?: string
        discriminator?: string
      }
    }
  }
  selfUser?: DiscordSelfUser
  bannerUrl?: string
}

export function GuildSidebar({ guild, guildId, user, selfUser, bannerUrl }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', collapsed ? '68px' : '230px')
  }, [collapsed])
  const base = `/dashboard/${guildId}`

  const groups: NavGroup[] = [
    {
      title: 'Analytics',
      items: [
        { label: 'Overview', href: base, icon: <BarChart2 size={16} /> },
        { label: 'Statistics', href: `${base}/statistics`, icon: <Activity size={16} /> },
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
  const claims = user.user_metadata?.custom_claims
  const displayName =
    selfUser?.global_name ??
    claims?.global_name ??
    selfUser?.username ??
    user.user_metadata?.full_name ??
    'User'
  const userAvatar = user.user_metadata?.avatar_url ?? ''
  const username = selfUser?.username ?? claims?.username
  const discriminator = selfUser?.discriminator ?? claims?.discriminator
  const discordId = user.user_metadata?.provider_id ?? user.id
  const memberCount = guild.approximate_member_count ?? guild.member_count

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r overflow-hidden"
      style={{
        width: collapsed ? '68px' : '230px',
        transition: 'width 0.2s ease',
        background: 'linear-gradient(180deg, var(--bg-2) 0%, var(--bg) 100%)',
        borderColor: 'var(--line-strong)',
      }}
    >
      {/* Brand */}
      <div
        className="flex items-center border-b px-3 py-4"
        style={{ borderColor: 'var(--line-strong)', minHeight: '65px' }}
      >
        {collapsed ? (
          <div className="flex flex-col items-center w-full gap-2">
            <Image
              src="/logo.png"
              alt="Pulsify"
              width={30}
              height={30}
              className="shrink-0"
            />
            <button
              onClick={() => setCollapsed(false)}
              title="Expand sidebar"
              className="flex items-center justify-center rounded-md p-0.5 transition-colors"
              style={{ color: 'var(--text-3)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        ) : (
          <>
            <Image
              src="/logo.png"
              alt="Pulsify"
              width={30}
              height={30}
              className="shrink-0"
            />
            <span className="ml-2.5 flex-1 font-bold text-base tracking-tight text-foreground">
              Pulsify
            </span>
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              className="shrink-0 flex items-center justify-center rounded-md p-0.5 transition-colors"
              style={{ color: 'var(--text-3)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
            >
              <ChevronLeft size={14} />
            </button>
          </>
        )}
      </div>

      {/* Server card */}
      <div
        className="mx-2 my-3 flex items-center rounded-xl cursor-pointer border"
        style={{
          background: 'var(--panel)',
          borderColor: 'var(--line-strong)',
          padding: collapsed ? '0.5rem' : '0.625rem',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: collapsed ? '0' : '0.625rem',
        }}
      >
        {icon ? (
          <Image
            src={icon}
            alt={guild.name}
            width={30}
            height={30}
            className="rounded-lg shrink-0"
            unoptimized
          />
        ) : (
          <div
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg shrink-0 font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
          >
            {guild.name.charAt(0)}
          </div>
        )}
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{guild.name}</p>
            {memberCount && (
              <p className="text-xs text-subtle">{memberCount.toLocaleString()} members</p>
            )}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-4">
        {groups.map((group) => (
          <div key={group.title}>
            {!collapsed && group.title && (
              <p className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-widest text-subtle">
                {group.title}
              </p>
            )}
            {collapsed && <div className="pt-2" />}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = item.href === base
                  ? pathname === base
                  : pathname.startsWith(item.href)

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className="flex items-center rounded-lg py-2 text-sm font-medium transition-all relative"
                    style={{
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      gap: collapsed ? '0' : '0.625rem',
                      paddingLeft: collapsed ? '0.5rem' : '0.625rem',
                      paddingRight: collapsed ? '0.5rem' : '0.625rem',
                      ...(isActive
                        ? {
                            background: 'linear-gradient(90deg, var(--p-soft), transparent)',
                            color: 'var(--text)',
                            boxShadow: 'inset 0 0 0 1px var(--p-soft)',
                          }
                        : { color: 'var(--text-2)' }),
                    }}
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
                    {isActive && !collapsed && (
                      <span
                        className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r"
                        style={{ background: 'var(--p-1)', boxShadow: '0 0 10px var(--p-glow)' }}
                      />
                    )}
                    <span style={isActive ? { color: 'var(--p-1)' } : {}}>{item.icon}</span>
                    {!collapsed && (
                      <>
                        <span className="flex-1">{item.label}</span>
                        {item.badge && (
                          <span
                            className="ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide leading-none"
                            style={{
                              background: 'linear-gradient(135deg, var(--p-1), var(--p-2))',
                              color: '#fff',
                            }}
                          >
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
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
          title={collapsed ? 'All Servers' : undefined}
          className="flex items-center rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground transition"
          style={{ justifyContent: collapsed ? 'center' : 'flex-start', gap: collapsed ? '0' : '0.625rem' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
        >
          <ChevronLeft size={16} />
          {!collapsed && 'All Servers'}
        </Link>

        <UserProfileButton
          displayName={displayName}
          username={username}
          discriminator={discriminator}
          discordId={discordId}
          email={user.email}
          avatarUrl={userAvatar}
          bannerUrl={bannerUrl}
          bannerColor={selfUser?.banner_color ?? undefined}
          collapsed={collapsed}
          popupDirection="up"
        />
      </div>
    </aside>
  )
}
