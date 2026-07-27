/**
 * Server Timeline — client-safe catalog, types and helpers (PULSIFY-63).
 *
 * The timeline is the server's history book: every significant change, whether
 * it was made in the Pulsify dashboard, through a slash command, or directly
 * inside Discord, lands in `timeline_events` and is read back here.
 *
 * NO `server-only` — the feed, filters, detail drawer and export builders all
 * run in the browser. The insert helper lives in `lib/timeline-server.ts`.
 *
 * Adding an event type is a two-file change: add it to TIMELINE_EVENTS below,
 * and (if the bot emits it) mirror the entry in `pulse-bot/src/timeline.js`.
 */

// ── Categories ───────────────────────────────────────────────────────────
// Coarse grouping the UI colour-codes, chips and groups by. Ordered the way
// the filter row renders them: structure first, then people, then everything
// the platform does on the server's behalf.
export const TIMELINE_CATEGORIES = [
  'roles',
  'channels',
  'members',
  'moderation',
  'economy',
  'automation',
  'events',
  'configuration',
] as const

export type TimelineCategory = (typeof TIMELINE_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<TimelineCategory, string> = {
  roles: 'Roles',
  channels: 'Channels',
  members: 'Members',
  moderation: 'Moderation',
  economy: 'Economy',
  automation: 'Automation',
  events: 'Events',
  configuration: 'Configuration',
}

/**
 * One accent per category. Deliberately reuses the notification palette
 * (components/dashboard/notifications/notification-style.ts) so an event that
 * appears in both surfaces carries the same colour in both.
 */
export const CATEGORY_ACCENT: Record<TimelineCategory, string> = {
  roles: '#a78bfa',
  channels: '#3b82f6',
  members: '#10b981',
  moderation: '#f87171',
  economy: '#34d399',
  automation: '#f59e0b',
  events: '#22d3ee',
  configuration: '#94a3b8',
}

export const CATEGORY_DESCRIPTIONS: Record<TimelineCategory, string> = {
  roles: 'Role creation, deletion, renames and permission changes.',
  channels: 'Channels and categories added, removed, moved or re-permissioned.',
  members: 'Joins, leaves, bans, kicks, timeouts and nickname changes.',
  moderation: 'Warnings, mutes, Pulse Guard detections and safety actions.',
  economy: 'Balance and reputation milestones, purchases and rewards.',
  automation: 'Automations created, updated, triggered or switched off.',
  events: 'Giveaways, scheduled events, polls and announcements.',
  configuration: 'Server settings, integrations, backups and templates.',
}

// ── Severity ─────────────────────────────────────────────────────────────
export const TIMELINE_SEVERITIES = ['info', 'success', 'warning', 'critical'] as const
export type TimelineSeverity = (typeof TIMELINE_SEVERITIES)[number]

export const SEVERITY_COLOR: Record<TimelineSeverity, string> = {
  info: '#3b82f6',
  success: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
}

// ── Source ───────────────────────────────────────────────────────────────
// Where a change came from. This is what the timeline offers that Discord's
// own Audit Log can't: it knows the difference between "an admin edited this
// in the dashboard" and "someone changed it in the Discord client".
export const TIMELINE_SOURCES = ['dashboard', 'discord', 'command', 'bot', 'system'] as const
export type TimelineSource = (typeof TIMELINE_SOURCES)[number]

export const SOURCE_LABELS: Record<TimelineSource, string> = {
  dashboard: 'Pulsify dashboard',
  discord: 'Discord',
  command: 'Slash command',
  bot: 'Pulse',
  system: 'System',
}

// ── Modules ──────────────────────────────────────────────────────────────
// Which part of Pulsify an event belongs to. Powers the module filter, the
// "most modified modules" statistic, and the card's quick-navigation link
// (`path` is appended to /dashboard/{guildId}).
export type TimelineModule = {
  label: string
  /** Dashboard route for "Open module", relative to the guild root. */
  path: string
}

export const TIMELINE_MODULES: Record<string, TimelineModule> = {
  roles: { label: 'Roles', path: '/roles' },
  channels: { label: 'Channels', path: '/channels' },
  members: { label: 'Members', path: '/members' },
  moderation: { label: 'Moderation', path: '/moderation' },
  'pulse-guard': { label: 'Pulse Guard', path: '/ai-moderation' },
  'alt-detection': { label: 'Alt Detection', path: '/alt-detection' },
  security: { label: 'DDoS Protection', path: '/security' },
  tickets: { label: 'Tickets', path: '/tickets' },
  giveaways: { label: 'Giveaways', path: '/giveaways' },
  polls: { label: 'Polls', path: '/polls' },
  events: { label: 'Events', path: '/events' },
  announcements: { label: 'Announcements', path: '/announcements' },
  automations: { label: 'Automations', path: '/automations-settings' },
  scheduled: { label: 'Scheduled', path: '/scheduled' },
  economy: { label: 'Economy', path: '/economy' },
  shop: { label: 'Shop', path: '/economy/shop' },
  leveling: { label: 'Levels & XP', path: '/leveling-settings' },
  milestones: { label: 'Milestones', path: '/milestones' },
  birthdays: { label: 'Birthdays', path: '/birthdays' },
  invites: { label: 'Invites', path: '/invites' },
  onboarding: { label: 'Onboarding', path: '/onboarding' },
  integrations: { label: 'Integrations', path: '/integrations' },
  backups: { label: 'Backups', path: '/backups' },
  templates: { label: 'Templates', path: '/templates' },
  settings: { label: 'Server Settings', path: '/server-settings' },
  commands: { label: 'Commands', path: '/commands' },
  'private-channels': { label: 'Private Channels', path: '/private-channels' },
  'self-roles': { label: 'Self-Assign Roles', path: '/roles' },
  'temporary-roles': { label: 'Temporary Roles', path: '/roles' },
  'statistics-channels': { label: 'Statistics Channels', path: '/channels' },
  assets: { label: 'Assets', path: '/assets' },
  presence: { label: 'Presence', path: '/presence' },
  bot: { label: 'Pulse Bot', path: '/commands' },
}

export function moduleLabel(module: string | null): string | null {
  if (!module) return null
  return TIMELINE_MODULES[module]?.label ?? module
}

/** Dashboard route for a module's own page, or null when it has none. */
export function modulePath(guildId: string, module: string | null): string | null {
  if (!module) return null
  const def = TIMELINE_MODULES[module]
  return def ? `/dashboard/${guildId}${def.path}` : null
}

// ── Target types ─────────────────────────────────────────────────────────
// The noun an event acted on. Drives the detail drawer's "Affected object"
// row and the icon glyph on the card.
export const TIMELINE_TARGET_TYPES = [
  'role', 'channel', 'member', 'message', 'automation', 'giveaway', 'poll',
  'event', 'announcement', 'integration', 'backup', 'template', 'setting',
  'reward', 'ticket', 'server',
] as const
export type TimelineTargetType = (typeof TIMELINE_TARGET_TYPES)[number]

export const TARGET_TYPE_LABELS: Record<TimelineTargetType, string> = {
  role: 'Role',
  channel: 'Channel',
  member: 'Member',
  message: 'Message',
  automation: 'Automation',
  giveaway: 'Giveaway',
  poll: 'Poll',
  event: 'Event',
  announcement: 'Announcement',
  integration: 'Integration',
  backup: 'Backup',
  template: 'Template',
  setting: 'Setting',
  reward: 'Reward',
  ticket: 'Ticket',
  server: 'Server',
}

// ── Event catalog ────────────────────────────────────────────────────────
// Every event type the timeline understands, and how to present it. `label`
// is the short name shown in the event-type filter and the CSV/PDF export;
// the card itself shows the stored `title`, which is written at record time
// with the real names in it.
export type TimelineEventDef = {
  category: TimelineCategory
  label: string
  /** Default module — an emitter can override per event. */
  module: string | null
  /** Default severity — an emitter can override per event. */
  severity: TimelineSeverity
  targetType: TimelineTargetType | null
}

export const TIMELINE_EVENTS = {
  // ── Roles ──────────────────────────────────────────────────────────────
  role_created:             { category: 'roles', label: 'Role created',              module: 'roles', severity: 'success', targetType: 'role' },
  role_deleted:             { category: 'roles', label: 'Role deleted',              module: 'roles', severity: 'warning', targetType: 'role' },
  role_renamed:             { category: 'roles', label: 'Role renamed',              module: 'roles', severity: 'info',    targetType: 'role' },
  role_permissions_changed: { category: 'roles', label: 'Role permissions changed',  module: 'roles', severity: 'warning', targetType: 'role' },
  role_updated:             { category: 'roles', label: 'Role updated',              module: 'roles', severity: 'info',    targetType: 'role' },
  role_assigned:            { category: 'roles', label: 'Role assigned',             module: 'roles', severity: 'info',    targetType: 'member' },
  role_unassigned:          { category: 'roles', label: 'Role removed',              module: 'roles', severity: 'info',    targetType: 'member' },
  temp_role_granted:        { category: 'roles', label: 'Temporary role granted',    module: 'temporary-roles', severity: 'success', targetType: 'member' },
  temp_role_extended:       { category: 'roles', label: 'Temporary role extended',   module: 'temporary-roles', severity: 'info',    targetType: 'member' },
  temp_role_expired:        { category: 'roles', label: 'Temporary role expired',    module: 'temporary-roles', severity: 'info',    targetType: 'member' },
  self_role_menu_published: { category: 'roles', label: 'Self-assign menu published', module: 'self-roles', severity: 'success', targetType: 'role' },

  // ── Channels ───────────────────────────────────────────────────────────
  channel_created:             { category: 'channels', label: 'Channel created',             module: 'channels', severity: 'success', targetType: 'channel' },
  channel_deleted:             { category: 'channels', label: 'Channel deleted',             module: 'channels', severity: 'warning', targetType: 'channel' },
  channel_renamed:             { category: 'channels', label: 'Channel renamed',             module: 'channels', severity: 'info',    targetType: 'channel' },
  channel_moved:               { category: 'channels', label: 'Channel moved',               module: 'channels', severity: 'info',    targetType: 'channel' },
  channel_permissions_changed: { category: 'channels', label: 'Channel permissions changed', module: 'channels', severity: 'warning', targetType: 'channel' },
  channel_updated:             { category: 'channels', label: 'Channel updated',             module: 'channels', severity: 'info',    targetType: 'channel' },
  category_changed:            { category: 'channels', label: 'Category changed',            module: 'channels', severity: 'info',    targetType: 'channel' },
  private_channel_created:     { category: 'channels', label: 'Private channel created',     module: 'private-channels', severity: 'info', targetType: 'channel' },
  statistics_channel_updated:  { category: 'channels', label: 'Statistics channel updated',  module: 'statistics-channels', severity: 'info', targetType: 'channel' },

  // ── Members ────────────────────────────────────────────────────────────
  member_joined:             { category: 'members', label: 'Member joined',      module: 'members', severity: 'success',  targetType: 'member' },
  member_left:               { category: 'members', label: 'Member left',        module: 'members', severity: 'info',     targetType: 'member' },
  member_banned:             { category: 'members', label: 'Member banned',      module: 'moderation', severity: 'critical', targetType: 'member' },
  member_unbanned:           { category: 'members', label: 'Member unbanned',    module: 'moderation', severity: 'info',   targetType: 'member' },
  member_kicked:             { category: 'members', label: 'Member kicked',      module: 'moderation', severity: 'warning', targetType: 'member' },
  member_timeout:            { category: 'members', label: 'Timeout applied',    module: 'moderation', severity: 'warning', targetType: 'member' },
  member_timeout_removed:    { category: 'members', label: 'Timeout lifted',     module: 'moderation', severity: 'info',    targetType: 'member' },
  member_nickname_changed:   { category: 'members', label: 'Nickname changed',   module: 'members', severity: 'info',      targetType: 'member' },
  member_milestone_reached:  { category: 'members', label: 'Milestone reached',  module: 'milestones', severity: 'success', targetType: 'member' },
  member_level_up:           { category: 'members', label: 'Member levelled up', module: 'leveling', severity: 'success',  targetType: 'member' },
  member_birthday:           { category: 'members', label: 'Birthday celebrated', module: 'birthdays', severity: 'success', targetType: 'member' },
  member_invited:            { category: 'members', label: 'Member invited',     module: 'invites', severity: 'info',      targetType: 'member' },

  // ── Moderation ─────────────────────────────────────────────────────────
  moderation_warning:  { category: 'moderation', label: 'Warning issued',        module: 'moderation', severity: 'warning',  targetType: 'member' },
  moderation_mute:     { category: 'moderation', label: 'Member muted',          module: 'moderation', severity: 'warning',  targetType: 'member' },
  moderation_action:   { category: 'moderation', label: 'Moderation action',     module: 'moderation', severity: 'warning',  targetType: 'member' },
  moderation_note:     { category: 'moderation', label: 'Moderator note added',  module: 'moderation', severity: 'info',     targetType: 'member' },
  guard_detection:     { category: 'moderation', label: 'Pulse Guard detection', module: 'pulse-guard', severity: 'warning', targetType: 'message' },
  guard_scam:          { category: 'moderation', label: 'Scam detected',         module: 'pulse-guard', severity: 'critical', targetType: 'message' },
  guard_toxic:         { category: 'moderation', label: 'Toxic message actioned', module: 'pulse-guard', severity: 'warning', targetType: 'message' },
  guard_override:      { category: 'moderation', label: 'Detection overridden',  module: 'pulse-guard', severity: 'info',     targetType: 'message' },
  alt_risk_flagged:    { category: 'moderation', label: 'Alt risk flagged',      module: 'alt-detection', severity: 'warning', targetType: 'member' },
  security_alert:      { category: 'moderation', label: 'Security alert',        module: 'security', severity: 'critical',    targetType: 'server' },
  security_mitigation: { category: 'moderation', label: 'Mitigation applied',    module: 'security', severity: 'warning',     targetType: 'server' },
  security_recovered:  { category: 'moderation', label: 'Mitigation lifted',     module: 'security', severity: 'success',     targetType: 'server' },
  ticket_opened:       { category: 'moderation', label: 'Ticket opened',         module: 'tickets', severity: 'info',         targetType: 'ticket' },
  ticket_closed:       { category: 'moderation', label: 'Ticket closed',         module: 'tickets', severity: 'info',         targetType: 'ticket' },
  application_submitted:      { category: 'moderation', label: 'Application submitted', module: 'tickets', severity: 'info',  targetType: 'ticket' },
  application_status_changed: { category: 'moderation', label: 'Application reviewed',  module: 'tickets', severity: 'info',  targetType: 'ticket' },

  // ── Economy ────────────────────────────────────────────────────────────
  economy_balance_milestone:    { category: 'economy', label: 'Balance milestone',    module: 'economy', severity: 'success', targetType: 'member' },
  economy_reputation_milestone: { category: 'economy', label: 'Reputation milestone', module: 'economy', severity: 'success', targetType: 'member' },
  economy_purchase:             { category: 'economy', label: 'Marketplace purchase', module: 'shop',    severity: 'info',    targetType: 'reward' },
  economy_reward_granted:       { category: 'economy', label: 'Economy reward',       module: 'economy', severity: 'success', targetType: 'member' },
  economy_reward_configured:    { category: 'economy', label: 'Reward configured',    module: 'shop',    severity: 'info',    targetType: 'reward' },

  // ── Automation ─────────────────────────────────────────────────────────
  automation_created:   { category: 'automation', label: 'Automation created',   module: 'automations', severity: 'success', targetType: 'automation' },
  automation_updated:   { category: 'automation', label: 'Automation updated',   module: 'automations', severity: 'info',    targetType: 'automation' },
  automation_triggered: { category: 'automation', label: 'Automation triggered', module: 'automations', severity: 'info',    targetType: 'automation' },
  automation_disabled:  { category: 'automation', label: 'Automation disabled',  module: 'automations', severity: 'warning', targetType: 'automation' },
  scheduled_created:    { category: 'automation', label: 'Schedule created',     module: 'scheduled',   severity: 'success', targetType: 'automation' },
  scheduled_updated:    { category: 'automation', label: 'Schedule updated',     module: 'scheduled',   severity: 'info',    targetType: 'automation' },
  scheduled_ran:        { category: 'automation', label: 'Schedule ran',         module: 'scheduled',   severity: 'info',    targetType: 'automation' },

  // ── Events ─────────────────────────────────────────────────────────────
  giveaway_started:       { category: 'events', label: 'Giveaway started',       module: 'giveaways',     severity: 'success', targetType: 'giveaway' },
  giveaway_ended:         { category: 'events', label: 'Giveaway ended',         module: 'giveaways',     severity: 'info',    targetType: 'giveaway' },
  giveaway_rerolled:      { category: 'events', label: 'Giveaway rerolled',      module: 'giveaways',     severity: 'info',    targetType: 'giveaway' },
  event_created:          { category: 'events', label: 'Event created',          module: 'events',        severity: 'success', targetType: 'event' },
  event_updated:          { category: 'events', label: 'Event updated',          module: 'events',        severity: 'info',    targetType: 'event' },
  event_deleted:          { category: 'events', label: 'Event cancelled',        module: 'events',        severity: 'warning', targetType: 'event' },
  poll_published:         { category: 'events', label: 'Poll published',         module: 'polls',         severity: 'success', targetType: 'poll' },
  poll_closed:            { category: 'events', label: 'Poll closed',            module: 'polls',         severity: 'info',    targetType: 'poll' },
  announcement_published: { category: 'events', label: 'Announcement published', module: 'announcements', severity: 'success', targetType: 'announcement' },
  announcement_failed:    { category: 'events', label: 'Announcement failed',    module: 'announcements', severity: 'critical', targetType: 'announcement' },

  // ── Configuration ──────────────────────────────────────────────────────
  settings_changed:         { category: 'configuration', label: 'Settings changed',        module: 'settings',      severity: 'info',    targetType: 'setting' },
  verification_updated:     { category: 'configuration', label: 'Verification updated',    module: 'settings',      severity: 'warning', targetType: 'setting' },
  server_profile_updated:   { category: 'configuration', label: 'Server profile updated',  module: 'settings',      severity: 'info',    targetType: 'server' },
  module_toggled:           { category: 'configuration', label: 'Module switched',         module: 'settings',      severity: 'info',    targetType: 'setting' },
  integration_connected:    { category: 'configuration', label: 'Integration connected',   module: 'integrations',  severity: 'success', targetType: 'integration' },
  integration_disconnected: { category: 'configuration', label: 'Integration disconnected', module: 'integrations', severity: 'warning', targetType: 'integration' },
  integration_error:        { category: 'configuration', label: 'Integration error',       module: 'integrations',  severity: 'critical', targetType: 'integration' },
  backup_created:           { category: 'configuration', label: 'Backup created',          module: 'backups',       severity: 'success', targetType: 'backup' },
  backup_restored:          { category: 'configuration', label: 'Backup restored',         module: 'backups',       severity: 'warning', targetType: 'backup' },
  backup_deleted:           { category: 'configuration', label: 'Backup deleted',          module: 'backups',       severity: 'warning', targetType: 'backup' },
  template_imported:        { category: 'configuration', label: 'Template applied',        module: 'templates',     severity: 'warning', targetType: 'template' },
  template_saved:           { category: 'configuration', label: 'Template saved',          module: 'templates',     severity: 'info',    targetType: 'template' },
  command_config_changed:   { category: 'configuration', label: 'Command configured',      module: 'commands',      severity: 'info',    targetType: 'setting' },
  onboarding_updated:       { category: 'configuration', label: 'Onboarding updated',      module: 'onboarding',    severity: 'info',    targetType: 'setting' },
  branding_updated:         { category: 'configuration', label: 'Bot branding updated',    module: 'bot',           severity: 'info',    targetType: 'setting' },
  presence_updated:         { category: 'configuration', label: 'Presence updated',        module: 'presence',      severity: 'info',    targetType: 'setting' },
  bot_error:                { category: 'configuration', label: 'Bot error',               module: 'bot',           severity: 'critical', targetType: 'server' },
} as const satisfies Record<string, TimelineEventDef>

export type TimelineEventType = keyof typeof TIMELINE_EVENTS

export const TIMELINE_EVENT_TYPES = Object.keys(TIMELINE_EVENTS) as TimelineEventType[]

/** Look up an event definition, tolerating an unknown type from an older row. */
export function eventDef(type: string): TimelineEventDef | null {
  return (TIMELINE_EVENTS as Record<string, TimelineEventDef>)[type] ?? null
}

/** Display label for an event type — falls back to a de-slugged version. */
export function eventLabel(type: string): string {
  const def = eventDef(type)
  if (def) return def.label
  return type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** Event types belonging to a category, in catalog order. */
export function eventTypesForCategory(category: TimelineCategory): TimelineEventType[] {
  return TIMELINE_EVENT_TYPES.filter((t) => TIMELINE_EVENTS[t].category === category)
}

// ── Row + query types ────────────────────────────────────────────────────

export type TimelineActor = {
  id: string | null
  name: string | null
  username: string | null
}

export type AffectedUser = { id: string; name?: string | null }

export type TimelineEvent = {
  id: string
  guildId: string
  category: TimelineCategory
  eventType: string
  module: string | null
  severity: TimelineSeverity
  source: TimelineSource
  title: string
  description: string | null
  actor: TimelineActor
  targetId: string | null
  targetName: string | null
  targetType: TimelineTargetType | null
  previousValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
  affectedUsers: AffectedUser[]
  metadata: Record<string, unknown>
  link: string | null
  createdAt: string
}

/** Raw `timeline_events` row shape as it comes back from Supabase. */
export type TimelineEventRow = {
  id: string
  guild_id: string
  category: string
  event_type: string
  module: string | null
  severity: string
  source: string
  title: string
  description: string | null
  actor_id: string | null
  actor_name: string | null
  actor_username: string | null
  target_id: string | null
  target_name: string | null
  target_type: string | null
  previous_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  affected_users: AffectedUser[] | null
  metadata: Record<string, unknown> | null
  link: string | null
  created_at: string
}

/**
 * Normalise a DB row into the camelCase shape the UI works with. Unknown
 * category/severity/source values (a row written by a newer bot than this
 * deploy) degrade to safe defaults rather than breaking the feed.
 */
export function toTimelineEvent(row: TimelineEventRow): TimelineEvent {
  const category = (TIMELINE_CATEGORIES as readonly string[]).includes(row.category)
    ? (row.category as TimelineCategory)
    : 'configuration'
  const severity = (TIMELINE_SEVERITIES as readonly string[]).includes(row.severity)
    ? (row.severity as TimelineSeverity)
    : 'info'
  const source = (TIMELINE_SOURCES as readonly string[]).includes(row.source)
    ? (row.source as TimelineSource)
    : 'system'
  const targetType =
    row.target_type && (TIMELINE_TARGET_TYPES as readonly string[]).includes(row.target_type)
      ? (row.target_type as TimelineTargetType)
      : null

  return {
    id: row.id,
    guildId: row.guild_id,
    category,
    eventType: row.event_type,
    module: row.module,
    severity,
    source,
    title: row.title,
    description: row.description,
    actor: { id: row.actor_id, name: row.actor_name, username: row.actor_username },
    targetId: row.target_id,
    targetName: row.target_name,
    targetType,
    previousValue: row.previous_value,
    newValue: row.new_value,
    affectedUsers: Array.isArray(row.affected_users) ? row.affected_users : [],
    metadata: row.metadata ?? {},
    link: row.link,
    createdAt: row.created_at,
  }
}

/** The filter set the feed, the stats strip and the exports all share. */
export type TimelineFilters = {
  category: TimelineCategory | 'all'
  /** Discord id of an administrator/actor, or 'all'. */
  actor: string | 'all'
  /** Discord id of an affected member (target or in affected_users), or 'all'. */
  member: string | 'all'
  module: string | 'all'
  eventType: string | 'all'
  /** Inclusive ISO date (YYYY-MM-DD) bounds, or null for open-ended. */
  from: string | null
  to: string | null
  /** Free-text search across title, description, actor and target. */
  query: string
}

export const EMPTY_FILTERS: TimelineFilters = {
  category: 'all',
  actor: 'all',
  member: 'all',
  module: 'all',
  eventType: 'all',
  from: null,
  to: null,
  query: '',
}

export function hasActiveFilters(f: TimelineFilters): boolean {
  return (
    f.category !== 'all' ||
    f.actor !== 'all' ||
    f.member !== 'all' ||
    f.module !== 'all' ||
    f.eventType !== 'all' ||
    f.from !== null ||
    f.to !== null ||
    f.query.trim() !== ''
  )
}

/** Serialise filters into the query string both the feed and export accept. */
export function filtersToParams(f: TimelineFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.category !== 'all') p.set('category', f.category)
  if (f.actor !== 'all') p.set('actor', f.actor)
  if (f.member !== 'all') p.set('member', f.member)
  if (f.module !== 'all') p.set('module', f.module)
  if (f.eventType !== 'all') p.set('type', f.eventType)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  const q = f.query.trim()
  if (q) p.set('q', q)
  return p
}

// ── Statistics ───────────────────────────────────────────────────────────

export type TimelineCount = { key: string; count: number }
export type TimelineActorCount = {
  id: string
  name: string | null
  username: string | null
  count: number
}

export type TimelineStats = {
  total: number
  today: number
  week: number
  month: number
  categories: TimelineCount[]
  modules: TimelineCount[]
  actors: TimelineActorCount[]
  /** 24 entries, UTC hour → event count. Sparse: missing hours mean zero. */
  hours: { hour: number; count: number }[]
  /** 0 = Sunday … 6 = Saturday, UTC. Sparse. */
  weekdays: { weekday: number; count: number }[]
  busiestDay: { day: string; count: number } | null
}

export const EMPTY_STATS: TimelineStats = {
  total: 0, today: 0, week: 0, month: 0,
  categories: [], modules: [], actors: [], hours: [], weekdays: [], busiestDay: null,
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Expand the sparse hour histogram into a dense 24-slot array for charting. */
export function denseHours(hours: TimelineStats['hours']): number[] {
  const out = new Array(24).fill(0)
  for (const h of hours) {
    if (h.hour >= 0 && h.hour < 24) out[h.hour] = h.count
  }
  return out
}

/** Expand the sparse weekday histogram into a dense 7-slot array. */
export function denseWeekdays(weekdays: TimelineStats['weekdays']): number[] {
  const out = new Array(7).fill(0)
  for (const d of weekdays) {
    if (d.weekday >= 0 && d.weekday < 7) out[d.weekday] = d.count
  }
  return out
}

/**
 * The busiest stretch of the day, expressed as a readable window. Finds the
 * 3-hour block with the highest total so "busiest period" reads as a period
 * ("18:00 — 21:00 UTC") rather than a single spiky hour.
 */
export function busiestWindow(hours: TimelineStats['hours']): string | null {
  const dense = denseHours(hours)
  if (dense.every((n) => n === 0)) return null
  let bestStart = 0
  let best = -1
  for (let start = 0; start < 24; start++) {
    const total = dense[start] + dense[(start + 1) % 24] + dense[(start + 2) % 24]
    if (total > best) {
      best = total
      bestStart = start
    }
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(bestStart)}:00 — ${pad((bestStart + 3) % 24)}:00 UTC`
}

// ── Formatting ───────────────────────────────────────────────────────────

/** Compact relative time, matching the notifications feed's wording. */
export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

/** Local YYYY-MM-DD key used to group the feed into day sections. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "Today" / "Yesterday" / "Friday, 18 July 2026" for a day-group heading. */
export function dayHeading(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date()
  const todayKey = dayKey(today.toISOString())
  if (key === todayKey) return 'Today'
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (key === dayKey(yesterday.toISOString())) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

/** Group a chronological list into day buckets, preserving order. */
export function groupByDay(events: TimelineEvent[]): { key: string; events: TimelineEvent[] }[] {
  const groups: { key: string; events: TimelineEvent[] }[] = []
  for (const e of events) {
    const key = dayKey(e.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.events.push(e)
    else groups.push({ key, events: [e] })
  }
  return groups
}

/** Render a stored before/after value for display in the detail drawer. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value.length > 0 ? value : '—'
  if (Array.isArray(value)) return value.length > 0 ? value.map(formatValue).join(', ') : '—'
  return JSON.stringify(value)
}

/** Turn a snake/camel key into a human field name ("rate_limit" → "Rate limit"). */
export function formatFieldName(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())
}

export type ValueDiff = { field: string; previous: unknown; next: unknown }

/**
 * Pair up previous/new values into a per-field diff. Fields present in only
 * one side still appear (with the other as undefined) so an added or removed
 * setting is visible; unchanged fields are dropped.
 */
export function diffValues(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): ValueDiff[] {
  if (!previous && !next) return []
  const keys = new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})])
  const out: ValueDiff[] = []
  for (const key of keys) {
    const a = previous?.[key]
    const b = next?.[key]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    out.push({ field: key, previous: a, next: b })
  }
  return out
}

// ── Export ───────────────────────────────────────────────────────────────
// CSV/JSON are built here so the client can export what's already loaded
// without a round trip; the API route reuses the same builders for
// "complete history" exports so both paths produce byte-identical files.

export const EXPORT_FORMATS = ['csv', 'json', 'pdf'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export const EXPORT_COLUMNS = [
  'Timestamp', 'Category', 'Event', 'Module', 'Severity', 'Source', 'Title',
  'Description', 'Actor', 'Actor ID', 'Target', 'Target ID', 'Target type',
  'Previous value', 'New value', 'Affected users',
] as const

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One CSV row per event, in EXPORT_COLUMNS order. */
export function toCsvRow(e: TimelineEvent): string {
  return [
    e.createdAt,
    CATEGORY_LABELS[e.category],
    eventLabel(e.eventType),
    moduleLabel(e.module) ?? '',
    e.severity,
    SOURCE_LABELS[e.source],
    e.title,
    e.description ?? '',
    formatActor(e.actor),
    e.actor.id ?? '',
    e.targetName ?? '',
    e.targetId ?? '',
    e.targetType ?? '',
    e.previousValue ? JSON.stringify(e.previousValue) : '',
    e.newValue ? JSON.stringify(e.newValue) : '',
    e.affectedUsers.map((u) => u.name ?? u.id).join('; '),
  ].map(csvEscape).join(',')
}

export function toCsv(events: TimelineEvent[]): string {
  return [EXPORT_COLUMNS.join(','), ...events.map(toCsvRow)].join('\n')
}

/** JSON export — the normalised shape plus a small provenance header. */
export function toJson(events: TimelineEvent[], meta: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      eventCount: events.length,
      ...meta,
      events,
    },
    null,
    2,
  )
}

/** "Display (handle)" — same rule the notification detail view uses. */
export function formatActor(actor: TimelineActor): string {
  const { name, username } = actor
  if (name && username && name !== username) return `${name} (${username})`
  return name ?? username ?? 'Pulse'
}

/** A filename stem that carries the scope, e.g. `timeline-my-server-2026-07-24`. */
export function exportFilename(guildName: string, format: ExportFormat): string {
  const slug = guildName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'server'
  return `history-${slug}-${new Date().toISOString().slice(0, 10)}.${format}`
}
