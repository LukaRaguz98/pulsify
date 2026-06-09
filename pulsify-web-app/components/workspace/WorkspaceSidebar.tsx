'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Home, Server, Users, StickyNote, ListChecks, ShieldAlert,
  Eye, LineChart, ChevronLeft, ChevronRight, Menu, X,
  SlidersHorizontal, MessagesSquare, BarChart3,
} from 'lucide-react'
import { UserProfileButton } from '@/components/dashboard/UserProfileButton'
import { WorkspaceSwitcher } from '@/components/workspace/WorkspaceSwitcher'
import { WorkspaceSearchTrigger } from '@/components/workspace/search/WorkspaceSearchTrigger'
import { TourMenuItem } from '@/components/dashboard/tour/DashboardTour'
import { can, type Capability, type Workspace, type WorkspaceRole, type WorkspaceSummary } from '@/lib/workspace'

type NavItem = { label: string; href: string; icon: React.ReactNode; cap?: Capability }
type NavGroup = {
  title: string
  /** Icon shown next to the category header — mirrors GuildSidebar's NavGroup pattern. */
  icon: React.ReactNode
  items: NavItem[]
}

type Props = {
  workspace: Workspace
  role: WorkspaceRole
  workspaces: WorkspaceSummary[]
  user: {
    displayName: string
    username?: string
    discriminator?: string
    discordId: string
    email?: string
    avatarUrl?: string
    bannerUrl?: string
    bannerColor?: string
  }
}

export function WorkspaceSidebar({ workspace, role, workspaces, user }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const base = `/workspace/${workspace.id}`

  useEffect(() => { setMobileOpen(false) }, [pathname])
  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileOpen])

  // Expose sidebar width so the chrome (CornerDecorations, Discord corner icon)
  // anchors against the workspace's 244px sidebar instead of the dashboard's
  // 230px default. Reset to default on unmount so the dashboard's GuildSidebar
  // can reclaim it cleanly when navigating back.
  useEffect(() => {
    const root = document.documentElement
    const prev = root.style.getPropertyValue('--sidebar-w')
    root.style.setProperty('--sidebar-w', '244px')
    return () => {
      if (prev) root.style.setProperty('--sidebar-w', prev)
      else root.style.removeProperty('--sidebar-w')
    }
  }, [])

  // Overview lives at the bare workspace base path — exact match only so
  // sub-routes don't keep it highlighted alongside their own item.
  const isItemActive = (href: string) =>
    href === base ? pathname === base : pathname.startsWith(href)

  // Overview is the workspace's "home" — it sits standalone at the top of the
  // nav, above any collapsible groups, so it's always reachable in one click.
  // Branding + ownership + danger zone are embedded into the Overview page
  // itself, so there's no separate "Settings" entry under Manage anymore.
  const overview: NavItem = { label: 'Overview', href: base, icon: <Home size={16} /> }

  const groups: NavGroup[] = [
    {
      title: 'Manage',
      icon: <SlidersHorizontal size={16} />,
      items: [
        { label: 'Servers', href: `${base}/servers`, icon: <Server size={16} /> },
        { label: 'Team', href: `${base}/team`, icon: <Users size={16} /> },
      ],
    },
    {
      title: 'Collaborate',
      icon: <MessagesSquare size={16} />,
      items: [
        { label: 'Notes', href: `${base}/notes`, icon: <StickyNote size={16} /> },
        { label: 'Tasks', href: `${base}/tasks`, icon: <ListChecks size={16} /> },
        { label: 'Incidents', href: `${base}/incidents`, icon: <ShieldAlert size={16} /> },
      ],
    },
    {
      title: 'Insights',
      icon: <BarChart3 size={16} />,
      items: [
        { label: 'Moderation', href: `${base}/moderation`, icon: <Eye size={16} />, cap: 'manageWatchlist' },
        { label: 'Analytics', href: `${base}/analytics`, icon: <LineChart size={16} />, cap: 'viewAnalytics' },
        // Notifications now live in the top-right bell — no sidebar entry.
      ],
    },
  ]

  // Default: expand any group containing the active route so the user always
  // lands with their current section open. Manual toggles afterwards stick
  // until a navigation reveals a different group.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const set = new Set<string>()
    for (const g of groups) {
      if (g.items.some((it) => isItemActive(it.href))) set.add(g.title)
    }
    return set
  })

  // Additively expand the group that contains the new active item on route
  // changes. We only *add* — never auto-collapse — so the user's manual
  // expansions on other groups stick around.
  useEffect(() => {
    const activeGroup = groups.find((g) => g.items.some((it) => isItemActive(it.href)))
    if (!activeGroup) return
    setExpandedGroups((prev) => (prev.has(activeGroup.title) ? prev : new Set([...prev, activeGroup.title])))
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

  const overviewActive = isItemActive(overview.href)

  // Current location for the mobile top bar — Section › Page, mirroring the
  // active sidebar item so the page stays identifiable while the drawer is
  // closed (matches GuildSidebar's mobile breadcrumb).
  const activeItem = [overview, ...groups.flatMap((g) => g.items)].find((it) => isItemActive(it.href))
  const activeSectionTitle = groups.find((g) => g.items.some((it) => isItemActive(it.href)))?.title
  const mobileCrumbSection = activeItem && activeItem !== overview ? activeSectionTitle : undefined
  const mobileCrumbTitle = activeItem?.label ?? workspace.name

  const nav = (
    <nav className="flex-1 overflow-y-auto px-2 pb-2 pt-3 space-y-1" data-tour="nav">
      {/* Standalone Overview — no parent category. Same row visual as the
          sub-items below so the user can scan the whole nav as a single list,
          just without the chevron + expand affordance. */}
      <Link
        href={overview.href}
        className="relative flex items-center rounded-lg py-2 text-sm font-semibold transition-all"
        style={{
          gap: '0.625rem',
          paddingLeft: '0.625rem',
          paddingRight: '0.625rem',
          ...(overviewActive
            ? {
                background: 'linear-gradient(90deg, var(--p-soft), transparent)',
                color: 'var(--text)',
                boxShadow: 'inset 0 0 0 1px var(--p-soft)',
              }
            : { color: 'var(--text-2)' }),
        }}
        onMouseEnter={(e) => {
          if (!overviewActive) {
            e.currentTarget.style.background = 'var(--panel)'
            e.currentTarget.style.color = 'var(--text)'
          }
        }}
        onMouseLeave={(e) => {
          if (!overviewActive) {
            e.currentTarget.style.background = ''
            e.currentTarget.style.color = 'var(--text-2)'
          }
        }}
      >
        {overviewActive && (
          <span
            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
            style={{ background: 'var(--p-1)', boxShadow: '0 0 10px var(--p-glow)' }}
          />
        )}
        <span style={overviewActive ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{overview.icon}</span>
        <span className="flex-1">{overview.label}</span>
      </Link>

      {groups.map((group) => {
        const visibleItems = group.items.filter((it) => !it.cap || can(role, it.cap))
        if (visibleItems.length === 0) return null
        const isExpanded = expandedGroups.has(group.title)
        const hasActiveChild = visibleItems.some((it) => isItemActive(it.href))
        const showChildren = isExpanded

        return (
          <div key={group.title}>
            {/* Category header — clickable to toggle. */}
            <button
              type="button"
              onClick={() => toggleGroup(group.title)}
              className="flex w-full items-center rounded-lg py-2 text-sm font-semibold transition-colors"
              style={{
                gap: '0.625rem',
                paddingLeft: '0.625rem',
                paddingRight: '0.625rem',
                color: hasActiveChild ? 'var(--text)' : 'var(--text-2)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
            >
              <span style={{ color: hasActiveChild ? 'var(--p-1)' : 'var(--text-3)' }}>
                {group.icon}
              </span>
              <span className="flex-1 text-left">{group.title}</span>
              {/* Single chevron rotated via transform so the open/close gesture
                  animates instead of jump-cutting between icons. */}
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
            </button>

            {/* Sub-items — always mounted so the close direction animates too.
                The grid-template-rows 0fr↔1fr trick animates between collapsed
                and natural height (max-height can't go to `auto`). inert +
                aria-hidden keep collapsed items out of the tab order. */}
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
                  {visibleItems.map((it) => {
                    const active = isItemActive(it.href)
                    return (
                      <Link
                        key={it.href}
                        href={it.href}
                        className="relative flex items-center rounded-lg py-1.5 text-sm font-medium transition-all"
                        style={{
                          gap: '0.625rem',
                          paddingLeft: '1.875rem',
                          paddingRight: '0.625rem',
                          ...(active
                            ? {
                                background: 'linear-gradient(90deg, var(--p-soft), transparent)',
                                color: 'var(--text)',
                                boxShadow: 'inset 0 0 0 1px var(--p-soft)',
                              }
                            : { color: 'var(--text-2)' }),
                        }}
                        onMouseEnter={(e) => {
                          if (!active) {
                            e.currentTarget.style.background = 'var(--panel)'
                            e.currentTarget.style.color = 'var(--text)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!active) {
                            e.currentTarget.style.background = ''
                            e.currentTarget.style.color = 'var(--text-2)'
                          }
                        }}
                      >
                        {active && (
                          <span
                            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
                            style={{ background: 'var(--p-1)', boxShadow: '0 0 10px var(--p-glow)' }}
                          />
                        )}
                        <span style={active ? { color: 'var(--p-1)' } : {}}>{it.icon}</span>
                        <span className="flex-1">{it.label}</span>
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
  )

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-30 flex h-12 items-center gap-2 border-b px-3" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', backdropFilter: 'blur(12px)' }}>
        <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors" style={{ color: 'var(--text-2)' }}>
          <Menu size={18} />
        </button>
        <Link href="/" aria-label="Pulsify home" className="flex shrink-0">
          <Image src="/logo.png" alt="Pulsify" width={22} height={22} className="shrink-0" />
        </Link>
        {/* Live breadcrumb — keeps the current page identifiable while the
            drawer is closed (mirrors the active sidebar item + its section). */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {mobileCrumbSection && (
            <>
              <span className="truncate text-sm" style={{ color: 'var(--text-3)' }}>
                {mobileCrumbSection}
              </span>
              <ChevronRight size={13} className="shrink-0" style={{ color: 'var(--text-3)' }} />
            </>
          )}
          <span className="truncate text-sm font-semibold text-foreground">{mobileCrumbTitle}</span>
        </div>
      </div>

      {mobileOpen && (
        <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="lg:hidden fixed inset-0 z-40 animate-in fade-in" style={{ background: 'rgba(0,0,0,0.55)' }} />
      )}

      <aside
        className="workspace-sidebar flex h-full w-[244px] shrink-0 flex-col border-r overflow-hidden"
        data-mobile-open={mobileOpen}
        style={{ transition: 'transform 0.25s ease', background: 'linear-gradient(180deg, var(--bg-2) 0%, var(--bg) 100%)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex items-center justify-between border-b px-3 py-3.5" style={{ borderColor: 'var(--line-strong)', minHeight: 65 }}>
          <Link href="/" aria-label="Pulsify home" className="flex items-center gap-2">
            <Image src="/logo.png" alt="Pulsify" width={26} height={26} className="shrink-0" />
            <span className="font-bold text-sm tracking-tight" style={{ color: 'var(--p-1)' }}>Pulsify</span>
          </Link>
          <button onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="lg:hidden rounded-md p-0.5" style={{ color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="relative z-50 px-2 pt-3" data-tour="workspace-switcher">
          <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
        </div>

        {/* Global search / command palette launcher. */}
        <div className="px-2 pt-2" data-tour="search">
          <WorkspaceSearchTrigger />
        </div>

        {nav}

        <div className="border-t p-2 space-y-0.5" style={{ borderColor: 'var(--line-strong)' }}>
          <TourMenuItem />
          <Link href="/dashboard" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground" onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel)' }} onMouseLeave={(e) => { e.currentTarget.style.background = '' }}>
            <ChevronLeft size={16} /> Back to servers
          </Link>
          <div data-tour="profile">
            <UserProfileButton
              displayName={user.displayName}
              username={user.username}
              discriminator={user.discriminator}
              discordId={user.discordId}
              email={user.email}
              avatarUrl={user.avatarUrl ?? ''}
              bannerUrl={user.bannerUrl}
              bannerColor={user.bannerColor}
              popupDirection="up"
            />
          </div>
        </div>
      </aside>
    </>
  )
}
