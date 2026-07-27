// Command palette + global search — shared types, the static command/action
// catalog, and the pure search engine that ranks a fetched index against a
// query. No JSX or framework imports live here: icons are referenced by lucide
// name (resolved in the UI layer, mirroring lib/automations.ts) so this module
// stays trivially testable and reusable from anywhere.

import { fuzzyMatchFields } from '@/lib/fuzzy'

// ── Categories ────────────────────────────────────────────────────────────────

export type SearchCategory =
  | 'action'
  | 'navigation'
  | 'member'
  | 'role'
  | 'channel'
  | 'event'
  | 'command'
  | 'automation'
  | 'moderation'
  | 'notification'

export const CATEGORY_META: Record<
  SearchCategory,
  { label: string; icon: string; accent: string; order: number }
> = {
  action: { label: 'Quick actions', icon: 'Zap', accent: 'var(--p-1)', order: 0 },
  navigation: { label: 'Go to', icon: 'Compass', accent: 'var(--text-2)', order: 1 },
  member: { label: 'Members', icon: 'UserRound', accent: '#60a5fa', order: 2 },
  role: { label: 'Roles', icon: 'Users', accent: '#a855f7', order: 3 },
  channel: { label: 'Channels', icon: 'Hash', accent: '#22d3ee', order: 4 },
  event: { label: 'Events', icon: 'CalendarDays', accent: '#818cf8', order: 5 },
  command: { label: 'Commands', icon: 'Command', accent: '#10b981', order: 6 },
  automation: { label: 'Automations', icon: 'CalendarClock', accent: '#f59e0b', order: 7 },
  moderation: { label: 'Moderation log', icon: 'Shield', accent: '#f87171', order: 8 },
  notification: { label: 'Notifications', icon: 'Bell', accent: '#ec4899', order: 9 },
}

// ── Result + action shapes ──────────────────────────────────────────────────

export type ResultAction =
  | { kind: 'navigate'; href: string }
  | { kind: 'command'; commandId: string }
  | { kind: 'pick-member'; memberAction: MemberActionKind }

export type MemberActionKind = 'warn' | 'timeout'

export type SearchResult = {
  /** Stable id, unique across a single render. */
  id: string
  category: SearchCategory
  title: string
  subtitle?: string
  /** lucide icon name; resolved in the UI. */
  icon: string
  /** Optional icon-chip accent override (defaults to the category accent). */
  accent?: string
  /** Avatar URL for member results — rendered instead of the icon chip. */
  imageUrl?: string
  /** Short uppercase tag rendered on the right (e.g. channel type, status). */
  badge?: string
  action: ResultAction
  /** Relevance score from the fuzzy matcher (0 for the static empty-state list). */
  score: number
}

// ── Static catalog: navigation + quick actions ──────────────────────────────
// `path` is appended to `/dashboard/{guildId}`. Keywords widen what a search
// term can hit beyond the visible label.

type NavDef = { id: string; label: string; icon: string; path: string; keywords?: string }

const NAV_CATALOG: NavDef[] = [
  { id: 'nav-overview', label: 'Overview', icon: 'BarChart2', path: '', keywords: 'home analytics dashboard summary' },
  { id: 'nav-statistics', label: 'Statistics', icon: 'Activity', path: '/statistics', keywords: 'stats analytics charts trends' },
  { id: 'nav-insights', label: 'Insights', icon: 'Lightbulb', path: '/insights', keywords: 'recommendations health suggestions trends growth analysis' },
  { id: 'nav-management', label: 'Staff', icon: 'UserCog', path: '/management', keywords: 'staff team moderators support performance leaderboard rankings accountability workload contributions admins analytics management' },
  { id: 'nav-channels', label: 'Channels', icon: 'Hash', path: '/channels', keywords: 'text voice category' },
  { id: 'nav-members', label: 'Members', icon: 'UserRound', path: '/members', keywords: 'users people directory' },
  { id: 'nav-roles', label: 'Roles', icon: 'Users', path: '/roles', keywords: 'permissions ranks self-assign auto-role auto role join on join hierarchy temporary' },
  { id: 'nav-assets', label: 'Assets', icon: 'Smile', path: '/assets', keywords: 'emoji emojis sticker stickers soundboard sounds expressions upload import export branding animated' },
  { id: 'nav-templates', label: 'Templates', icon: 'LayoutTemplate', path: '/templates', keywords: 'server templates presets reuse export import config setup deploy clone copy backup configuration blueprint' },
  { id: 'nav-timeline', label: 'History', icon: 'History', path: '/timeline', keywords: 'timeline history audit log activity changes who changed what when trail record chronology investigate troubleshoot export csv pdf json' },
  { id: 'nav-events', label: 'Events', icon: 'CalendarDays', path: '/events', keywords: 'scheduled events calendar' },
  { id: 'nav-commands', label: 'Commands', icon: 'Command', path: '/commands', keywords: 'slash bot command center' },
  { id: 'nav-presence', label: 'Presence', icon: 'Radio', path: '/presence', keywords: 'status activity rotation playing watching listening streaming maintenance bot presence' },
  { id: 'nav-integrations', label: 'Integrations', icon: 'Plug', path: '/integrations', keywords: 'integrations connect external services github gitlab youtube tiktok twitch kick reddit twitter x rss steam patreon google calendar trello jira notion notifications sync hub' },
  { id: 'nav-scheduled', label: 'Scheduled', icon: 'CalendarClock', path: '/scheduled', keywords: 'workflows recurring tasks' },
  { id: 'nav-moderation', label: 'Moderation', icon: 'Shield', path: '/moderation', keywords: 'mod bans kicks warnings timeouts logs' },
  { id: 'nav-pulse-guard', label: 'Pulse Guard', icon: 'ShieldAlert', path: '/ai-moderation', keywords: 'ai moderation automod' },
  { id: 'nav-tickets', label: 'Tickets', icon: 'LifeBuoy', path: '/tickets', keywords: 'support tickets help desk panel transcripts' },
  { id: 'nav-ddos-protection', label: 'DDoS Protection', icon: 'Siren', path: '/security', keywords: 'security ddos protection abuse spike raid rate limit lockdown mitigation alerts monitoring traffic flood' },
  { id: 'nav-alt-detection', label: 'Alt Detection', icon: 'Fingerprint', path: '/alt-detection', keywords: 'alt alts alternate account throwaway smurf sockpuppet ban evasion evader risk score lookup investigation linked accounts safety suspicious multi account' },
  { id: 'nav-giveaways', label: 'Giveaways', icon: 'Gift', path: '/giveaways', keywords: 'giveaway contest raffle prize draw winners engagement' },
  { id: 'nav-milestones', label: 'Milestones', icon: 'Award', path: '/milestones', keywords: 'milestones recognition rewards achievements anniversary tenure veteran loyalty roles retention' },
  { id: 'nav-birthdays', label: 'Birthdays', icon: 'Cake', path: '/birthdays', keywords: 'birthday birthdays celebrate celebration cake age member profile announcement role reward engagement social upcoming calendar' },
  { id: 'nav-invites', label: 'Invites', icon: 'UserPlus', path: '/invites', keywords: 'invite invites tracking referral referrals inviter leaderboard rewards valid fake retention farming anti-abuse growth who invited vanity credits milestones' },
  { id: 'nav-economy', label: 'Economy', icon: 'Coins', path: '/economy', keywords: 'economy coins balance wallet reputation global currency transactions ledger leaderboard richest pay transfer circulation overview' },
  { id: 'nav-economy-earning', label: 'Earnings settings', icon: 'Sparkles', path: '/economy-earning', keywords: 'earnings settings rewards earning earn coins activity messages voice reactions daily weekly streak multipliers anti-abuse onboarding events giveaways simulator config how to earn' },
  { id: 'nav-shop', label: 'Shop', icon: 'ShoppingBag', path: '/economy/shop', keywords: 'shop store rewards spend buy purchase roles perks boosters cosmetics coins marketplace' },
  { id: 'nav-inventory', label: 'Inventory', icon: 'Backpack', path: '/economy/inventory', keywords: 'inventory owned items rewards purchases redeem activate boosters perks' },
  { id: 'nav-economy-controls', label: 'Economy Controls', icon: 'Crown', path: '/economy/controls', keywords: 'economy controls grant remove adjust coins operator audit moderation log' },
  { id: 'nav-notifications', label: 'Notifications', icon: 'Bell', path: '/notifications', keywords: 'alerts activity feed' },
  { id: 'nav-server-profile', label: 'Server Profile', icon: 'Server', path: '/server-settings', keywords: 'server settings branding' },
  { id: 'nav-preferences', label: 'Preferences', icon: 'SlidersHorizontal', path: '/settings', keywords: 'theme appearance density settings' },
  { id: 'nav-ticket-settings', label: 'Ticket settings', icon: 'LifeBuoy', path: '/ticket-settings', keywords: 'tickets support panel config setup auto-close transcript' },
  { id: 'nav-guard-settings', label: 'Pulse Guard settings', icon: 'ShieldAlert', path: '/ai-moderation-settings', keywords: 'pulse guard ai moderation sensitivity detectors auto-action exclusions config' },
  { id: 'nav-ddos-settings', label: 'DDoS Protection settings', icon: 'Siren', path: '/security-settings', keywords: 'security ddos protection rules thresholds rate limit mitigation auto-lockdown alert channel config setup presets' },
  { id: 'nav-pulse-assistant', label: 'Pulse assistant', icon: 'Sparkles', path: '/server-settings', keywords: 'assistant ai chat generation content tone language embed color colour server settings' },
  { id: 'nav-notification-settings', label: 'Notification settings', icon: 'Bell', path: '/notification-settings', keywords: 'notifications alerts toasts events preferences' },
  { id: 'nav-leveling-settings', label: 'Level settings', icon: 'Trophy', path: '/leveling-settings', keywords: 'levels xp leveling rewards roles curve cooldown progression rank' },
  { id: 'nav-birthday-settings', label: 'Birthday settings', icon: 'Cake', path: '/birthday-settings', keywords: 'birthday birthdays settings channel announcement time timezone role reward message template celebrate config setup' },
]

type ActionDef = {
  id: string
  label: string
  subtitle?: string
  icon: string
  keywords?: string
  action: ResultAction
}

const ACTION_CATALOG: ActionDef[] = [
  { id: 'act-create-event', label: 'Create event', subtitle: 'Schedule a new Discord event', icon: 'CalendarPlus', keywords: 'new event schedule add', action: { kind: 'navigate', href: '/events?new=1' } },
  { id: 'act-create-role', label: 'Create role', subtitle: 'Add a new server role', icon: 'Plus', keywords: 'new role add permission', action: { kind: 'navigate', href: '/roles?new=1' } },
  { id: 'act-save-template', label: 'Save as template', subtitle: "Snapshot this server's enabled features", icon: 'LayoutTemplate', keywords: 'template save snapshot feature profile reuse export setup blueprint toggles', action: { kind: 'navigate', href: '/templates?new=1' } },
  { id: 'act-import-template', label: 'Import a template', subtitle: 'Apply a saved or shared configuration', icon: 'Upload', keywords: 'template import json apply deploy config setup restore', action: { kind: 'navigate', href: '/templates?import=1' } },
  { id: 'act-manage-assets', label: 'Manage assets', subtitle: 'Emojis, stickers & soundboard sounds', icon: 'Smile', keywords: 'assets emoji emojis sticker stickers soundboard sounds expressions upload import export rename delete branding', action: { kind: 'navigate', href: '/assets' } },
  { id: 'act-warn-member', label: 'Warn a member', subtitle: 'Record a warning against a member', icon: 'AlertCircle', keywords: 'warning moderate discipline', action: { kind: 'pick-member', memberAction: 'warn' } },
  { id: 'act-timeout-member', label: 'Timeout a member', subtitle: 'Temporarily mute a member', icon: 'Clock', keywords: 'mute timeout moderate silence', action: { kind: 'pick-member', memberAction: 'timeout' } },
  { id: 'act-open-analytics', label: 'Open analytics', subtitle: 'Jump to the server overview', icon: 'LineChart', keywords: 'stats analytics dashboard', action: { kind: 'navigate', href: '' } },
  { id: 'act-open-insights', label: 'Open insights', subtitle: 'Server health & recommendations', icon: 'Lightbulb', keywords: 'insights recommendations health suggestions', action: { kind: 'navigate', href: '/insights' } },
  { id: 'act-open-management', label: 'Open management analytics', subtitle: 'Staff performance & leaderboards', icon: 'UserCog', keywords: 'management staff team moderators support performance rankings leaderboard workload accountability', action: { kind: 'navigate', href: '/management' } },
  { id: 'act-open-moderation', label: 'Open moderation', subtitle: 'Jump to moderation tools', icon: 'Shield', keywords: 'mod moderation bans', action: { kind: 'navigate', href: '/moderation' } },
  { id: 'act-open-tickets', label: 'Open tickets', subtitle: 'Manage support tickets', icon: 'LifeBuoy', keywords: 'support tickets help desk', action: { kind: 'navigate', href: '/tickets' } },
  { id: 'act-check-account', label: 'Check an account for alt risk', subtitle: 'Score a member & find potential linked accounts', icon: 'Fingerprint', keywords: 'alt alts alternate throwaway smurf sockpuppet ban evasion risk score lookup check account investigate suspicious linked', action: { kind: 'navigate', href: '/alt-detection' } },
  { id: 'act-create-giveaway', label: 'Create giveaway', subtitle: 'Launch a new Discord giveaway', icon: 'Gift', keywords: 'new giveaway contest raffle prize draw', action: { kind: 'navigate', href: '/giveaways?new=1' } },
  { id: 'act-create-milestone', label: 'Create milestone', subtitle: 'Reward members for activity & tenure', icon: 'Award', keywords: 'new milestone recognition reward achievement anniversary tenure veteran role', action: { kind: 'navigate', href: '/milestones?new=1' } },
  { id: 'act-configure-birthdays', label: 'Configure birthdays', subtitle: 'Channel, time, role & rewards', icon: 'Cake', keywords: 'birthday birthdays celebrate settings channel announcement time role reward', action: { kind: 'navigate', href: '/birthday-settings' } },
  { id: 'act-configure-invites', label: 'Configure invite tracking', subtitle: 'Valid-invite rules & anti-abuse', icon: 'UserPlus', keywords: 'invite invites referral tracking settings valid rules anti-abuse account age onboarding alt spike configure', action: { kind: 'navigate', href: '/invite-settings' } },
  { id: 'act-invite-rewards', label: 'Create an invite reward', subtitle: 'Reward inviters via a milestone', icon: 'Award', keywords: 'invite invites referral reward rewards milestone inviter valid role create configure', action: { kind: 'navigate', href: '/milestones?new=1' } },
  { id: 'act-invite-leaderboard', label: 'View invite leaderboard', subtitle: 'Top inviters by score', icon: 'Trophy', keywords: 'invite invites leaderboard top inviters ranking referral score valid', action: { kind: 'navigate', href: '/invites?tab=leaderboard' } },
  { id: 'act-open-leaderboard', label: 'Open leaderboard', subtitle: 'Top members by level, XP & reputation', icon: 'Trophy', keywords: 'leaderboard ranking levels xp top members rank progression', action: { kind: 'navigate', href: '/members?tab=leaderboard' } },
  { id: 'act-open-economy', label: 'Open economy', subtitle: 'Global balance, reputation & transactions', icon: 'Coins', keywords: 'economy coins balance wallet reputation transactions leaderboard grant remove adjust', action: { kind: 'navigate', href: '/economy' } },
  { id: 'act-trigger-sync', label: 'Trigger server sync', subtitle: 'Refresh dashboard data from Discord', icon: 'RefreshCw', keywords: 'sync refresh resync update reload', action: { kind: 'command', commandId: 'sync' } },
  { id: 'act-open-integrations', label: 'Connect an integration', subtitle: 'Wire up GitHub, YouTube, RSS, Notion & more', icon: 'Plug', keywords: 'integrations connect external services notifications sync hub github youtube twitch reddit rss', action: { kind: 'navigate', href: '/integrations' } },
  { id: 'act-open-timeline', label: 'Open the server timeline', subtitle: 'Everything that changed, in order', icon: 'History', keywords: 'timeline history audit log what changed who changed when trail record investigate troubleshoot chronology', action: { kind: 'navigate', href: '/timeline' } },
  { id: 'act-timeline-moderation', label: 'Review moderation history', subtitle: 'Bans, kicks, timeouts & warnings over time', icon: 'Shield', keywords: 'timeline moderation history bans kicks timeouts warnings audit review investigate who banned', action: { kind: 'navigate', href: '/timeline?category=moderation' } },
  { id: 'act-timeline-config', label: 'Review configuration changes', subtitle: 'Settings, integrations, backups & templates', icon: 'SlidersHorizontal', keywords: 'timeline configuration settings changed history who changed setting integration backup restore template verification audit', action: { kind: 'navigate', href: '/timeline?category=configuration' } },
  { id: 'act-export-timeline', label: 'Export the timeline', subtitle: 'CSV, JSON or a PDF report', icon: 'Download', keywords: 'export timeline history csv json pdf report download audit compliance record', action: { kind: 'navigate', href: '/timeline' } },
]

function withGuild(guildId: string, path: string): string {
  return `/dashboard/${guildId}${path}`
}

// ── Search index (snapshot the API returns and the client caches) ────────────

export type IndexMember = {
  id: string
  name: string
  handle: string
  avatar: string | null
  bot: boolean
  inTimeout: boolean
}
export type IndexRole = { id: string; name: string; color: number; memberHint: number | null }
export type IndexChannel = { id: string; name: string; type: number; parent: string | null }
export type IndexEvent = { id: string; name: string; status: number; start: string; location: string | null }
export type IndexCommand = { name: string; description: string; category: string; enabled: boolean }
export type IndexAutomation = { id: string; name: string; actionLabel: string; enabled: boolean }
export type IndexModLog = {
  id: string
  action: string
  target: string | null
  moderator: string | null
  reason: string | null
  createdAt: string
}
export type IndexNotification = {
  id: string
  title: string
  body: string | null
  category: string
  link: string | null
  createdAt: string
}

export type SearchIndex = {
  members: IndexMember[]
  roles: IndexRole[]
  channels: IndexChannel[]
  events: IndexEvent[]
  commands: IndexCommand[]
  automations: IndexAutomation[]
  moderationLogs: IndexModLog[]
  notifications: IndexNotification[]
  generatedAt: string
}

export const EMPTY_INDEX: SearchIndex = {
  members: [],
  roles: [],
  channels: [],
  events: [],
  commands: [],
  automations: [],
  moderationLogs: [],
  notifications: [],
  generatedAt: '',
}

// ── Display helpers ─────────────────────────────────────────────────────────

const CHANNEL_TYPE_TAG: Record<number, string> = {
  0: 'TEXT', 2: 'VOICE', 4: 'CATEGORY', 5: 'NEWS', 13: 'STAGE', 15: 'FORUM', 16: 'MEDIA',
}
const CHANNEL_TYPE_ICON: Record<number, string> = {
  0: 'Hash', 2: 'Volume2', 4: 'Folder', 5: 'Megaphone', 13: 'Radio', 15: 'MessagesSquare', 16: 'Image',
}
const EVENT_STATUS_TAG: Record<number, string> = { 1: 'SCHEDULED', 2: 'LIVE', 3: 'DONE', 4: 'CANCELED' }
const MOD_ACTION_LABEL: Record<string, string> = {
  ban: 'Banned', unban: 'Unbanned', kick: 'Kicked', timeout: 'Timed out',
  remove_timeout: 'Timeout removed', warn: 'Warned', nickname: 'Nickname change',
  add_role: 'Role added', remove_role: 'Role removed',
  delete_message: 'Message deleted', bulk_delete_messages: 'Messages purged',
}

// ── Search engine ────────────────────────────────────────────────────────────

/** Per-category cap in the combined results view. */
export const CATEGORY_LIMIT = 6

/**
 * Rank the static catalog + fetched index against `query`. With an empty query
 * it returns the static quick-actions and navigation entries (the empty-state
 * launcher). The component groups the flat list by category for display.
 */
export function runSearch(query: string, index: SearchIndex, guildId: string): SearchResult[] {
  const q = query.trim()
  const results: SearchResult[] = []
  const push = (r: SearchResult) => results.push(r)

  // Static: quick actions
  for (const a of ACTION_CATALOG) {
    const score = q ? fuzzyMatchFields(q, [a.label, a.keywords, a.subtitle]) : 0
    if (score === null) continue
    const action: ResultAction =
      a.action.kind === 'navigate' ? { kind: 'navigate', href: withGuild(guildId, a.action.href) } : a.action
    push({ id: a.id, category: 'action', title: a.label, subtitle: a.subtitle, icon: a.icon, action, score })
  }

  // Static: navigation
  for (const n of NAV_CATALOG) {
    const score = q ? fuzzyMatchFields(q, [n.label, n.keywords]) : 0
    if (score === null) continue
    push({
      id: n.id,
      category: 'navigation',
      title: n.label,
      icon: n.icon,
      action: { kind: 'navigate', href: withGuild(guildId, n.path) },
      score,
    })
  }

  // Dynamic index entries only contribute once the user starts typing — the
  // empty state stays a clean launcher of actions + destinations.
  if (!q) return results

  for (const m of index.members) {
    const score = fuzzyMatchFields(q, [m.name, m.handle])
    if (score === null) continue
    push({
      id: `member-${m.id}`,
      category: 'member',
      title: m.name,
      subtitle: `@${m.handle}`,
      icon: m.bot ? 'Bot' : 'UserRound',
      imageUrl: m.avatar ?? undefined,
      badge: m.inTimeout ? 'TIMEOUT' : m.bot ? 'BOT' : undefined,
      action: { kind: 'navigate', href: withGuild(guildId, `/members/${m.id}`) },
      score,
    })
  }

  for (const r of index.roles) {
    const score = fuzzyMatchFields(q, [r.name])
    if (score === null) continue
    push({
      id: `role-${r.id}`,
      category: 'role',
      title: r.name,
      subtitle: r.memberHint != null ? `${r.memberHint} member${r.memberHint === 1 ? '' : 's'}` : undefined,
      icon: 'Users',
      accent: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : undefined,
      action: { kind: 'navigate', href: withGuild(guildId, '/roles') },
      score,
    })
  }

  for (const c of index.channels) {
    const score = fuzzyMatchFields(q, [c.name, c.parent])
    if (score === null) continue
    push({
      id: `channel-${c.id}`,
      category: 'channel',
      title: c.name,
      subtitle: c.parent ?? undefined,
      icon: CHANNEL_TYPE_ICON[c.type] ?? 'Hash',
      badge: CHANNEL_TYPE_TAG[c.type],
      action: { kind: 'navigate', href: withGuild(guildId, '/channels') },
      score,
    })
  }

  for (const e of index.events) {
    const score = fuzzyMatchFields(q, [e.name, e.location])
    if (score === null) continue
    push({
      id: `event-${e.id}`,
      category: 'event',
      title: e.name,
      subtitle: e.location ?? new Date(e.start).toLocaleString(),
      icon: 'CalendarDays',
      badge: EVENT_STATUS_TAG[e.status],
      action: { kind: 'navigate', href: withGuild(guildId, '/events') },
      score,
    })
  }

  for (const c of index.commands) {
    const score = fuzzyMatchFields(q, [c.name, c.description])
    if (score === null) continue
    push({
      id: `command-${c.name}`,
      category: 'command',
      title: `/${c.name}`,
      subtitle: c.description,
      icon: 'Command',
      badge: c.enabled ? undefined : 'OFF',
      action: { kind: 'navigate', href: withGuild(guildId, '/commands') },
      score,
    })
  }

  for (const a of index.automations) {
    const score = fuzzyMatchFields(q, [a.name, a.actionLabel])
    if (score === null) continue
    push({
      id: `automation-${a.id}`,
      category: 'automation',
      title: a.name,
      subtitle: a.actionLabel,
      icon: 'CalendarClock',
      badge: a.enabled ? undefined : 'PAUSED',
      action: { kind: 'navigate', href: withGuild(guildId, '/scheduled') },
      score,
    })
  }

  for (const l of index.moderationLogs) {
    const label = MOD_ACTION_LABEL[l.action] ?? l.action.replace(/_/g, ' ')
    const score = fuzzyMatchFields(q, [l.target, label, l.moderator, l.reason])
    if (score === null) continue
    push({
      id: `modlog-${l.id}`,
      category: 'moderation',
      title: l.target ? `${label} — ${l.target}` : label,
      subtitle: l.reason ?? (l.moderator ? `by ${l.moderator}` : undefined),
      icon: 'Shield',
      action: { kind: 'navigate', href: withGuild(guildId, '/moderation') },
      score,
    })
  }

  for (const n of index.notifications) {
    const score = fuzzyMatchFields(q, [n.title, n.body, n.category])
    if (score === null) continue
    push({
      id: `notif-${n.id}`,
      category: 'notification',
      title: n.title,
      subtitle: n.body ?? n.category,
      icon: 'Bell',
      action: { kind: 'navigate', href: n.link ?? withGuild(guildId, '/notifications') },
      score,
    })
  }

  return results
}

/** Filter the index members alone — used by the "pick a member" sub-mode. */
export function searchMembers(query: string, index: SearchIndex): IndexMember[] {
  const q = query.trim()
  const scored: { m: IndexMember; score: number }[] = []
  for (const m of index.members) {
    const score = q ? fuzzyMatchFields(q, [m.name, m.handle]) : 0
    if (score === null) continue
    scored.push({ m, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 50).map((s) => s.m)
}

export type GroupedResults = {
  category: SearchCategory
  label: string
  icon: string
  accent: string
  items: SearchResult[]
  /** Total matches before the per-category cap, for the "+N more" hint. */
  total: number
}[]

/**
 * Group a flat result list into capped, ordered sections. Sections are ordered
 * by their strongest hit (most relevant category first); the static
 * action/navigation sections keep their leading slots for the empty state.
 */
export function groupResults(results: SearchResult[], hasQuery: boolean): GroupedResults {
  const byCat = new Map<SearchCategory, SearchResult[]>()
  for (const r of results) {
    const arr = byCat.get(r.category)
    if (arr) arr.push(r)
    else byCat.set(r.category, [r])
  }

  const groups: GroupedResults = []
  for (const [category, items] of byCat) {
    items.sort((a, b) => b.score - a.score)
    const meta = CATEGORY_META[category]
    groups.push({
      category,
      label: meta.label,
      icon: meta.icon,
      accent: meta.accent,
      items: items.slice(0, CATEGORY_LIMIT),
      total: items.length,
    })
  }

  groups.sort((a, b) => {
    // Empty state: fixed catalog order (actions first, then navigation).
    if (!hasQuery) return CATEGORY_META[a.category].order - CATEGORY_META[b.category].order
    // Query: float the section with the strongest match to the top, falling
    // back to the catalog order on ties.
    const aBest = a.items[0]?.score ?? -Infinity
    const bBest = b.items[0]?.score ?? -Infinity
    if (bBest !== aBest) return bBest - aBest
    return CATEGORY_META[a.category].order - CATEGORY_META[b.category].order
  })
  return groups
}
