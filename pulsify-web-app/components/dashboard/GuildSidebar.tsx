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
  Hash,
  ChevronLeft,
  ChevronRight,
  Settings,
  LineChart,
  Server,
  Sparkles,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { UserProfileButton } from '@/components/dashboard/UserProfileButton'

type NavItem = {
  label: string
  href: string
  icon: React.ReactNode
  badge?: string
}

type NavGroup = {
  title: string
  /** Icon shown next to the category header (and in collapsed-sidebar mode). */
  icon: React.ReactNode
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

  // Overview lives at the bare `base` path, so it matches only on equality;
  // other items use prefix matching so nested routes still highlight.
  const isItemActive = (href: string) =>
    href === base ? pathname === base : pathname.startsWith(href)

  // Nav is grouped by what the admin is *trying to do*, top-down:
  //   1. Analytics  — observe what's happening (passive views)
  //   2. Server     — structural config: what exists in the server
  //   3. Engagement — proactive features that drive member activity
  //   4. Safety     — reactive tools for moderation & incident response
  //   5. Settings   — personalisation of the dashboard itself
  //
  // Adding a new view: drop it into the group that matches its intent.
  //   • Welcome / Reaction roles / Leveling / Polls → Engagement
  //   • Audit log / AutoMod / Logs                  → Safety
  //   • Integrations / Billing / Account            → Settings
  //   • New server entity (Members deep-dive, etc.) → Server
  //   • New chart / report                          → Analytics
  const groups: NavGroup[] = [
    {
      title: 'Analytics',
      icon: <LineChart size={16} />,
      items: [
        { label: 'Overview', href: base, icon: <BarChart2 size={16} /> },
        { label: 'Statistics', href: `${base}/statistics`, icon: <Activity size={16} /> },
      ],
    },
    {
      title: 'Server',
      icon: <Server size={16} />,
      items: [
        { label: 'Channels', href: `${base}/channels`, icon: <Hash size={16} /> },
        { label: 'Roles', href: `${base}/roles`, icon: <Users size={16} /> },
        { label: 'Events', href: `${base}/events`, icon: <CalendarDays size={16} /> },
      ],
    },
    {
      title: 'Engagement',
      icon: <Sparkles size={16} />,
      items: [
        { label: 'Automations', href: `${base}/automations`, icon: <Zap size={16} /> },
      ],
    },
    {
      title: 'Safety',
      icon: <ShieldCheck size={16} />,
      items: [
        { label: 'Moderation', href: `${base}/moderation`, icon: <Shield size={16} /> },
      ],
    },
    {
      title: 'Settings',
      icon: <Settings size={16} />,
      items: [
        { label: 'Preferences', href: `${base}/settings`, icon: <SlidersHorizontal size={16} /> },
      ],
    },
  ]

  // Default: expand any group containing the currently-active route, so the
  // user always lands with their current section open. Manual toggles
  // afterwards survive until a navigation reveals a different group.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const set = new Set<string>()
    for (const g of groups) {
      if (g.items.some((item) => isItemActive(item.href))) set.add(g.title)
    }
    return set
  })

  // On route change, additively expand the group containing the new active
  // item. We only *add* — never auto-collapse — so the user's manual
  // expansions on other groups stick around.
  useEffect(() => {
    const activeGroup = groups.find((g) =>
      g.items.some((item) => isItemActive(item.href)),
    )
    if (!activeGroup) return
    setExpandedGroups((prev) =>
      prev.has(activeGroup.title) ? prev : new Set([...prev, activeGroup.title]),
    )
    // groups/isItemActive are recreated each render but logically depend on pathname
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  function toggleGroup(title: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

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

      {/* Server card — doubles as the entry point to the Server Profile
          (server-settings) page. Replaces the old nav item under "Server"
          so the affordance lives where users actually look first. Highlights
          when that route is active, same as any other nav link. */}
      {(() => {
        const serverProfileHref = `${base}/server-settings`
        const profileActive = isItemActive(serverProfileHref)
        return (
          <Link
            href={serverProfileHref}
            title={collapsed ? `${guild.name} — Server Profile` : 'Open Server Profile'}
            className="mx-2 my-3 flex items-center rounded-xl border transition-colors"
            style={{
              background: profileActive ? 'var(--p-soft)' : 'var(--panel)',
              borderColor: profileActive ? 'var(--p-1)' : 'var(--line-strong)',
              padding: collapsed ? '0.5rem' : '0.625rem',
              justifyContent: collapsed ? 'center' : 'flex-start',
              gap: collapsed ? '0' : '0.625rem',
            }}
            onMouseEnter={(e) => {
              if (!profileActive) e.currentTarget.style.background = 'var(--bg-2)'
            }}
            onMouseLeave={(e) => {
              if (!profileActive) e.currentTarget.style.background = 'var(--panel)'
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
          </Link>
        )
      })()}

      {/* Nav — categories are the primary level. Click a category header to
          toggle its sub-items. In collapsed-sidebar mode each category is a
          single icon; clicking expands the sidebar *and* opens that category. */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {groups.map((group) => {
          const isExpanded = expandedGroups.has(group.title)
          const hasActiveChild = group.items.some((item) => isItemActive(item.href))
          const showChildren = !collapsed && isExpanded

          return (
            <div key={group.title}>
              {/* Category header */}
              <button
                type="button"
                onClick={() => {
                  if (collapsed) {
                    // Expand sidebar AND open this category in one click —
                    // otherwise the user has to expand the sidebar, then
                    // click the chevron, which is two steps for one intent.
                    setCollapsed(false)
                    setExpandedGroups((prev) =>
                      prev.has(group.title) ? prev : new Set([...prev, group.title]),
                    )
                  } else {
                    toggleGroup(group.title)
                  }
                }}
                title={collapsed ? group.title : undefined}
                className="flex w-full items-center rounded-lg py-2 text-sm font-semibold transition-colors"
                style={{
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  gap: collapsed ? '0' : '0.625rem',
                  paddingLeft: collapsed ? '0.5rem' : '0.625rem',
                  paddingRight: collapsed ? '0.5rem' : '0.625rem',
                  color: hasActiveChild ? 'var(--text)' : 'var(--text-2)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
              >
                <span style={{ color: hasActiveChild ? 'var(--p-1)' : 'var(--text-3)' }}>
                  {group.icon}
                </span>
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{group.title}</span>
                    {/* Single chevron rotated via transform so the open/close
                        gesture animates instead of jump-cutting between icons. */}
                    <span
                      style={{
                        color: 'var(--text-3)',
                        display: 'inline-flex',
                        transition: 'transform 0.2s ease',
                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      }}
                    >
                      <ChevronRight size={13} />
                    </span>
                  </>
                )}
                {/* Collapsed-mode active-section dot — sits in the corner so
                    the user can spot their current section in the icon strip. */}
                {collapsed && hasActiveChild && (
                  <span
                    className="absolute mt-[-18px] ml-[18px] h-1.5 w-1.5 rounded-full"
                    style={{ background: 'var(--p-1)', boxShadow: '0 0 6px var(--p-glow)' }}
                  />
                )}
              </button>

              {/* Sub-items — always mounted so the close direction animates
                  too. The grid-template-rows 0fr↔1fr trick animates between
                  collapsed and natural height (max-height can't go to `auto`).
                  inert + aria-hidden keep collapsed items out of tab order. */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateRows: showChildren ? '1fr' : '0fr',
                  opacity: showChildren ? 1 : 0,
                  transition: 'grid-template-rows 0.22s ease, opacity 0.18s ease',
                }}
                aria-hidden={!showChildren}
                inert={!showChildren}
              >
                <div style={{ overflow: 'hidden', minHeight: 0 }}>
                  <div className="mt-0.5 space-y-0.5 pl-1">
                  {group.items.map((item) => {
                    const isActive = isItemActive(item.href)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="relative flex items-center rounded-lg py-1.5 text-sm font-medium transition-all"
                        style={{
                          gap: '0.625rem',
                          paddingLeft: '1.875rem',
                          paddingRight: '0.625rem',
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
                        {isActive && (
                          <span
                            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
                            style={{ background: 'var(--p-1)', boxShadow: '0 0 10px var(--p-glow)' }}
                          />
                        )}
                        <span style={isActive ? { color: 'var(--p-1)' } : {}}>{item.icon}</span>
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
                      </Link>
                    )
                  })}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
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
