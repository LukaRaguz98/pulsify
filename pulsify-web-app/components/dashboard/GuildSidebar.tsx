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
  CalendarClock,
  Shield,
  ShieldAlert,
  Users,
  Hash,
  ChevronLeft,
  ChevronRight,
  LineChart,
  Server,
  Sparkles,
  ShieldCheck,
  TerminalSquare,
  Command,
  Radio,
  UserRound,
  UserCog,
  Lightbulb,
  LifeBuoy,
  Gift,
  Award,
  Megaphone,
  Building2,
  Plug,
  LayoutTemplate,
  DatabaseBackup,
  Rocket,
  Coins,
  Lock,
  Menu,
  X,
  Star,
  Trophy,
  ShoppingBag,
  Backpack,
  Crown,
  Vote,
  BarChart3,
  Siren,
  Smile,
  Cake,
  Fingerprint,
} from 'lucide-react'
import { UserProfileButton } from '@/components/dashboard/UserProfileButton'
import { SearchTrigger } from '@/components/dashboard/search/SearchTrigger'
import { TourMenuItem } from '@/components/dashboard/tour/DashboardTour'
import { ViewSwitcherMenuItem } from '@/components/dashboard/ViewSwitcher'

type NavItem = {
  label: string
  href: string
  icon: React.ReactNode
  badge?: string
  /**
   * Extra path prefixes that should also mark this item active. Used when a
   * feature's settings live at a sibling route (e.g. Tickets ↔ /ticket-settings)
   * so the sidebar stays in context instead of de-highlighting everything.
   */
  matchPrefixes?: string[]
  /** Marks an operator-only item — renders a lock indicator so the operator
   *  knows it's visible to them alone (others never see the item). */
  locked?: boolean
  /** Match this item on path equality only (for parents of sibling routes,
   *  e.g. Economy › Overview at /economy vs /economy/shop). */
  exact?: boolean
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
  /** Bot operators see operator-only nav items (e.g. Presence). */
  isOperator?: boolean
  /** What the viewer should see: full management nav ('admin') or the
   *  read-only member nav ('member'). Defaults to admin. */
  viewerRole?: 'admin' | 'member'
}

export function GuildSidebar({
  guild,
  guildId,
  user,
  selfUser,
  bannerUrl,
  isOperator,
  viewerRole = 'admin',
}: Props) {
  const [collapsed, setCollapsed] = useState(false)
  // Mobile-only: the sidebar is an off-canvas drawer below `lg`. `mobileOpen`
  // drives the slide (via the `.guild-sidebar[data-mobile-open]` CSS) and the
  // backdrop; it has no effect on desktop where the aside is in-flow.
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', collapsed ? '68px' : '230px')
  }, [collapsed])

  // While the drawer is open, lock body scroll so the page behind it doesn't
  // scroll under the overlay on touch.
  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileOpen])

  const base = `/dashboard/${guildId}`
  const isMember = viewerRole === 'member'

  // Overview lives at the bare `base` path, so it matches only on equality;
  // other items use prefix matching so nested routes still highlight.
  const isItemActive = (href: string, exact = false) =>
    href === base || exact ? pathname === href : pathname.startsWith(href)

  // Item-aware variant: also honours `matchPrefixes` so a feature's sibling
  // settings route (e.g. /ticket-settings) keeps its module highlighted.
  const isNavItemActive = (item: NavItem): boolean =>
    isItemActive(item.href, item.exact) ||
    (item.matchPrefixes?.some((p) => pathname.startsWith(`${base}${p}`)) ?? false)

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
  // Overview is the dashboard's "home" — it sits standalone at the top of the
  // nav, above any collapsible groups, so it's always one click away. Members
  // have no Overview (it's a management surface); their home is Profile,
  // inside the "You" group.
  const overview: NavItem | null = isMember
    ? null
    : { label: 'Overview', href: base, icon: <BarChart2 size={16} /> }

  // The Economy category is shared by both navs: the economy is global and
  // read-oriented, so members see it too. Controls is the operator-only
  // exception (adjusting the global economy), locked like Presence.
  const economyGroup: NavGroup = {
    title: 'Economy',
    icon: <Coins size={16} />,
    items: [
      // The economy overview is the "Earnings" hub; it also hosts the
      // operator-only "Earnings settings" (earning config) at /economy-earning,
      // so keep this item highlighted there.
      { label: 'Earnings', href: `${base}/economy`, icon: <Coins size={16} />, exact: true, matchPrefixes: ['/economy-earning'] },
      // Server reward creation/management now lives inside the Shop (admins see
      // the controls there; members don't), so there's no separate Rewards page.
      { label: 'Shop', href: `${base}/economy/shop`, icon: <ShoppingBag size={16} /> },
      { label: 'Inventory', href: `${base}/economy/inventory`, icon: <Backpack size={16} /> },
      ...(isOperator && !isMember
        ? [{ label: 'Controls', href: `${base}/economy/controls`, icon: <Crown size={16} />, locked: true }]
        : []),
    ],
  }

  // Member nav: only the community-facing, read-only surfaces. Management
  // modules (moderation, config, billing, …) are absent entirely — and their
  // routes are enforced server-side, so this is presentation, not security.
  const memberGroups: NavGroup[] = [
    {
      title: 'You',
      icon: <UserRound size={16} />,
      items: [
        { label: 'Profile', href: `${base}/profile`, icon: <UserRound size={16} /> },
        { label: 'Reputation', href: `${base}/reputation`, icon: <Star size={16} /> },
      ],
    },
    {
      title: 'Community',
      icon: <Sparkles size={16} />,
      items: [
        { label: 'Leaderboards', href: `${base}/leaderboard`, icon: <Trophy size={16} /> },
        { label: 'Statistics', href: `${base}/statistics`, icon: <Activity size={16} /> },
        { label: 'Events', href: `${base}/events`, icon: <CalendarDays size={16} /> },
        { label: 'Giveaways', href: `${base}/giveaways`, icon: <Gift size={16} /> },
        { label: 'Polls', href: `${base}/polls`, icon: <Vote size={16} /> },
        // Read-only for members: who's celebrating today, who's next, and the
        // calendar. Setting their own birthday lives on their profile.
        { label: 'Birthdays', href: `${base}/birthdays`, icon: <Cake size={16} /> },
        { label: 'Announcements', href: `${base}/announcements`, icon: <Megaphone size={16} /> },
      ],
    },
    economyGroup,
  ]

  const adminGroups: NavGroup[] = [
    {
      title: 'Analytics',
      icon: <LineChart size={16} />,
      items: [
        { label: 'Statistics', href: `${base}/statistics`, icon: <Activity size={16} /> },
        { label: 'Insights', href: `${base}/insights`, icon: <Lightbulb size={16} /> },
        { label: 'Management', href: `${base}/management`, icon: <UserCog size={16} /> },
      ],
    },
    {
      title: 'Server',
      icon: <Server size={16} />,
      items: [
        { label: 'Onboarding', href: `${base}/onboarding`, icon: <Rocket size={16} /> },
        { label: 'Channels', href: `${base}/channels`, icon: <Hash size={16} />, matchPrefixes: ['/private-channels', '/private-channels-settings'] },
        { label: 'Members', href: `${base}/members`, icon: <UserRound size={16} />, matchPrefixes: ['/leveling-settings', '/leaderboard', '/profile', '/reputation'] },
        { label: 'Roles', href: `${base}/roles`, icon: <Users size={16} /> },
        { label: 'Assets', href: `${base}/assets`, icon: <Smile size={16} /> },
        { label: 'Templates', href: `${base}/templates`, icon: <LayoutTemplate size={16} /> },
        { label: 'Backups', href: `${base}/backups`, icon: <DatabaseBackup size={16} /> },
      ],
    },
    {
      title: 'Pulse Bot',
      icon: <TerminalSquare size={16} />,
      items: [
        { label: 'Commands', href: `${base}/commands`, icon: <Command size={16} /> },
        { label: 'Integrations', href: `${base}/integrations`, icon: <Plug size={16} /> },
        // Presence is a bot-wide, operator-only surface — hide it from everyone
        // else (the page itself re-checks operator status server-side).
        ...(isOperator
          ? [{ label: 'Presence', href: `${base}/presence`, icon: <Radio size={16} />, locked: true }]
          : []),
      ],
    },
    {
      title: 'Engagement',
      icon: <Sparkles size={16} />,
      items: [
        { label: 'Events', href: `${base}/events`, icon: <CalendarDays size={16} /> },
        { label: 'Announcements', href: `${base}/announcements`, icon: <Megaphone size={16} /> },
        { label: 'Scheduled', href: `${base}/scheduled`, icon: <CalendarClock size={16} /> },
        { label: 'Giveaways', href: `${base}/giveaways`, icon: <Gift size={16} /> },
        { label: 'Polls', href: `${base}/polls`, icon: <Vote size={16} /> },
        { label: 'Milestones', href: `${base}/milestones`, icon: <Award size={16} /> },
        { label: 'Birthdays', href: `${base}/birthdays`, icon: <Cake size={16} />, matchPrefixes: ['/birthday-settings'] },
      ],
    },
    economyGroup,
    {
      title: 'Safety',
      icon: <ShieldCheck size={16} />,
      items: [
        { label: 'Moderation', href: `${base}/moderation`, icon: <Shield size={16} /> },
        { label: 'Pulse Guard', href: `${base}/ai-moderation`, icon: <ShieldAlert size={16} /> },
        // Ticket configuration lives at /ticket-settings (reached from the
        // Tickets module's own "Settings" button) — match it here so the nav
        // stays on Tickets while you're editing its config.
        { label: 'Tickets', href: `${base}/tickets`, icon: <LifeBuoy size={16} />, matchPrefixes: ['/ticket-settings'] },
        { label: 'DDoS Protection', href: `${base}/security`, icon: <Siren size={16} />, matchPrefixes: ['/security-settings'] },
        { label: 'Alt Detection', href: `${base}/alt-detection`, icon: <Fingerprint size={16} /> },
      ],
    },
    // Dashboard-level Preferences moved to the global /preferences route
    // (reached from the choose-server view's top-right corner). Feature
    // settings still live with their features (Pulse → Pulse Bot, Tickets →
    // Tickets, …) inside their respective groups above.
  ]

  const groups = isMember ? memberGroups : adminGroups

  // Default: expand any group containing the currently-active route, so the
  // user always lands with their current section open. Manual toggles
  // afterwards survive until a navigation reveals a different group.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const set = new Set<string>()
    for (const g of groups) {
      if (g.items.some((item) => isNavItemActive(item))) set.add(g.title)
    }
    return set
  })

  // On route change: dismiss the mobile drawer (a nav tap should navigate AND
  // close the overlay) and additively expand the group containing the new
  // active item. We only *add* — never auto-collapse — so the user's manual
  // expansions on other groups stick around.
  useEffect(() => {
    setMobileOpen(false)
    const activeGroup = groups.find((g) =>
      g.items.some((item) => isNavItemActive(item)),
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

  // Current location for the mobile top bar. While the off-canvas drawer is
  // closed it's the only "where am I" cue, so mirror the active sidebar item
  // (prefixed with its section) as a breadcrumb — Section › Page.
  const serverSettingsHref = `${base}/server-settings`
  const activeItem = [...(overview ? [overview] : []), ...groups.flatMap((g) => g.items)].find(isNavItemActive)
  const activeSectionTitle = groups.find((g) => g.items.some(isNavItemActive))?.title
  const mobileCrumbSection = activeItem && activeItem !== overview ? activeSectionTitle : undefined
  const mobileCrumbTitle = isItemActive(serverSettingsHref)
    ? 'Server Profile'
    : activeItem?.label ?? 'Dashboard'

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
    <>
      {/* Mobile top bar (< lg only). The sidebar slides off-canvas on small
          screens, so this fixed bar holds the drawer toggle + brand. Desktop
          never sees it. */}
      <div
        className="lg:hidden fixed top-0 inset-x-0 z-30 flex h-12 items-center gap-2 border-b px-3"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', backdropFilter: 'blur(12px)' }}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors"
          style={{ color: 'var(--text-2)' }}
        >
          <Menu size={18} />
        </button>
        <Link href="/" className="flex shrink-0 items-center" aria-label="Pulsify home">
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

      {/* Backdrop — tap to dismiss the drawer. */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 z-40 animate-in fade-in"
          style={{ background: 'rgba(0,0,0,0.55)' }}
        />
      )}

      <aside
        className="guild-sidebar flex h-full shrink-0 flex-col border-r overflow-hidden"
        data-mobile-open={mobileOpen}
        style={{
          width: collapsed ? '68px' : '230px',
          transition: 'width 0.2s ease, transform 0.25s ease',
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
            <Link href="/" aria-label="Pulsify home" className="flex shrink-0">
              <Image
                src="/logo.png"
                alt="Pulsify"
                width={30}
                height={30}
                className="shrink-0"
              />
            </Link>
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
            <Link href="/" aria-label="Pulsify home" className="flex flex-1 items-center">
              <Image
                src="/logo.png"
                alt="Pulsify"
                width={30}
                height={30}
                className="shrink-0"
              />
              <span className="ml-2.5 font-bold text-base tracking-tight text-foreground">
                Pulsify
              </span>
            </Link>
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              className="max-lg:hidden shrink-0 flex items-center justify-center rounded-md p-0.5 transition-colors"
              style={{ color: 'var(--text-3)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
            >
              <ChevronLeft size={14} />
            </button>
            {/* Mobile-only: close the drawer (the collapse affordance is
                desktop-only — on mobile the sidebar slides away entirely). */}
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="lg:hidden shrink-0 flex items-center justify-center rounded-md p-0.5 transition-colors"
              style={{ color: 'var(--text-3)' }}
            >
              <X size={16} />
            </button>
          </>
        )}
      </div>

      {/* Server card — doubles as the entry point to the Server Profile
          (server-settings) page. Replaces the old nav item under "Server"
          so the affordance lives where users actually look first. Highlights
          when that route is active, same as any other nav link. Members get a
          static card — Server Profile is a management surface. */}
      {(() => {
        const serverProfileHref = `${base}/server-settings`
        const profileActive = !isMember && isItemActive(serverProfileHref)
        const cardBody = (
          <>
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
          </>
        )
        const cardStyle: React.CSSProperties = {
          background: profileActive ? 'var(--p-soft)' : 'var(--panel)',
          borderColor: profileActive ? 'var(--p-1)' : 'var(--line-strong)',
          padding: collapsed ? '0.5rem' : '0.625rem',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: collapsed ? '0' : '0.625rem',
        }
        if (isMember) {
          return (
            <div
              data-tour="server-card"
              title={guild.name}
              className="mx-2 my-3 flex items-center rounded-xl border"
              style={cardStyle}
            >
              {cardBody}
            </div>
          )
        }
        return (
          <Link
            href={serverProfileHref}
            data-tour="server-card"
            title={collapsed ? `${guild.name} — Server Profile` : 'Open Server Profile'}
            className="mx-2 my-3 flex items-center rounded-xl border transition-colors"
            style={cardStyle}
            onMouseEnter={(e) => {
              if (!profileActive) e.currentTarget.style.background = 'var(--bg-2)'
            }}
            onMouseLeave={(e) => {
              if (!profileActive) e.currentTarget.style.background = 'var(--panel)'
            }}
          >
            {cardBody}
          </Link>
        )
      })()}

      {/* Global search / command palette launcher — management-only chrome
          (the palette indexes admin routes & actions). */}
      {!isMember && (
        <div className="px-2 pb-2" data-tour="search">
          <SearchTrigger collapsed={collapsed} />
        </div>
      )}

      {/* Nav — categories are the primary level. Click a category header to
          toggle its sub-items. In collapsed-sidebar mode each category is a
          single icon; clicking expands the sidebar *and* opens that category.
          Overview is special-cased above the groups so it's a one-click
          target rather than living inside Analytics. */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-1" data-tour="nav">
        {overview && (() => {
          const active = isNavItemActive(overview)
          return (
            <Link
              key={overview.href}
              href={overview.href}
              title={collapsed ? overview.label : undefined}
              className="relative flex items-center rounded-lg py-2 text-sm font-semibold transition-all"
              style={{
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: collapsed ? '0' : '0.625rem',
                paddingLeft: collapsed ? '0.5rem' : '0.625rem',
                paddingRight: collapsed ? '0.5rem' : '0.625rem',
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
              {active && !collapsed && (
                <span
                  className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
                  style={{ background: 'var(--p-1)', boxShadow: '0 0 10px var(--p-glow)' }}
                />
              )}
              <span style={active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{overview.icon}</span>
              {!collapsed && <span className="flex-1">{overview.label}</span>}
              {/* Collapsed-mode active dot, matching the group headers. */}
              {collapsed && active && (
                <span
                  className="absolute mt-[-18px] ml-[18px] h-1.5 w-1.5 rounded-full"
                  style={{ background: 'var(--p-1)', boxShadow: '0 0 6px var(--p-glow)' }}
                />
              )}
            </Link>
          )
        })()}

        {groups.map((group) => {
          const isExpanded = expandedGroups.has(group.title)
          const hasActiveChild = group.items.some((item) => isNavItemActive(item))
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
                    const isActive = isNavItemActive(item)
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
                        {item.locked && (
                          <Lock
                            size={12}
                            className="ml-auto shrink-0"
                            style={{ color: 'var(--p-1)' }}
                            aria-label="Operator-only"
                          />
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
        {!isMember && <TourMenuItem />}
        {/* Mobile-only: the operator's "preview as member" entry (the floating
            icon is desktop-only). Operators in admin view only — mirrors the
            layout's gate, which `!isMember` already implies here. */}
        {!isMember && isOperator && <ViewSwitcherMenuItem guildId={guildId} />}

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

        <Link
          href="/workspace"
          data-tour="workspaces"
          title={collapsed ? 'Workspaces' : undefined}
          className="flex items-center rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground transition"
          style={{ justifyContent: collapsed ? 'center' : 'flex-start', gap: collapsed ? '0' : '0.625rem' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
        >
          <Building2 size={16} />
          {!collapsed && 'Workspaces'}
        </Link>

        <div data-tour="profile">
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
      </div>
    </aside>
    </>
  )
}
