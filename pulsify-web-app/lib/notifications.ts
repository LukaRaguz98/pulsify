/**
 * Client-safe constants, types, and labels for the notifications system.
 *
 * Server-only helpers (the `recordNotification` insert function) live in
 * `lib/notifications-server.ts` so this file can be imported from client
 * components without pulling in `next/headers` and breaking the build.
 */

/**
 * Discrete event types the notifications system understands. Used as both the
 * stored `type` column and the key in `notification_preferences.enabled_types`
 * so the user can toggle each one independently.
 */
export const NOTIFICATION_TYPES = [
  // members
  'member_join',
  'member_leave',
  // moderation
  'mod_action',
  // roles
  'role_created',
  'role_updated',
  'role_deleted',
  // events
  'event_created',
  'event_updated',
  'event_deleted',
  // channels
  'channel_created',
  'channel_updated',
  'channel_deleted',
  // settings
  'server_settings_changed',
  // automations
  'automation_saved',
  'automation_triggered',
  // tickets
  'ticket_opened',
  'ticket_updated',
  'ticket_closed',
  // giveaways
  'giveaway_started',
  'giveaway_ended',
  'giveaway_rerolled',
  // bot
  'bot_warning',
  'bot_error',
] as const

export type NotificationType = typeof NOTIFICATION_TYPES[number]

export type NotificationCategory =
  | 'members'
  | 'moderation'
  | 'roles'
  | 'events'
  | 'channels'
  | 'settings'
  | 'automations'
  | 'tickets'
  | 'giveaways'
  | 'bot'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'

/** Map type → category so callers don't have to remember the grouping. */
export const TYPE_TO_CATEGORY: Record<NotificationType, NotificationCategory> = {
  member_join: 'members',
  member_leave: 'members',
  mod_action: 'moderation',
  role_created: 'roles',
  role_updated: 'roles',
  role_deleted: 'roles',
  event_created: 'events',
  event_updated: 'events',
  event_deleted: 'events',
  channel_created: 'channels',
  channel_updated: 'channels',
  channel_deleted: 'channels',
  server_settings_changed: 'settings',
  automation_saved: 'automations',
  automation_triggered: 'automations',
  ticket_opened: 'tickets',
  ticket_updated: 'tickets',
  ticket_closed: 'tickets',
  giveaway_started: 'giveaways',
  giveaway_ended: 'giveaways',
  giveaway_rerolled: 'giveaways',
  bot_warning: 'bot',
  bot_error: 'bot',
}

/** Default severity per type. Callers can override via the `severity` field. */
export const TYPE_TO_SEVERITY: Record<NotificationType, NotificationSeverity> = {
  member_join: 'success',
  member_leave: 'info',
  mod_action: 'warning',
  role_created: 'success',
  role_updated: 'info',
  role_deleted: 'warning',
  event_created: 'success',
  event_updated: 'info',
  event_deleted: 'warning',
  channel_created: 'success',
  channel_updated: 'info',
  channel_deleted: 'warning',
  server_settings_changed: 'info',
  automation_saved: 'info',
  automation_triggered: 'info',
  ticket_opened: 'info',
  ticket_updated: 'info',
  ticket_closed: 'info',
  giveaway_started: 'success',
  giveaway_ended: 'success',
  giveaway_rerolled: 'info',
  bot_warning: 'warning',
  bot_error: 'error',
}

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  members: 'Members',
  moderation: 'Moderation',
  roles: 'Roles',
  events: 'Events',
  channels: 'Channels',
  settings: 'Settings',
  automations: 'Automations',
  tickets: 'Tickets',
  giveaways: 'Giveaways',
  bot: 'Bot Status',
}

export const TYPE_LABELS: Record<NotificationType, string> = {
  member_join: 'Member joins',
  member_leave: 'Member leaves',
  mod_action: 'Moderation actions',
  role_created: 'Role created',
  role_updated: 'Role updated',
  role_deleted: 'Role deleted',
  event_created: 'Event created',
  event_updated: 'Event updated',
  event_deleted: 'Event deleted',
  channel_created: 'Channel created',
  channel_updated: 'Channel updated',
  channel_deleted: 'Channel deleted',
  server_settings_changed: 'Server settings changed',
  automation_saved: 'Automation saved',
  automation_triggered: 'Automation triggered',
  ticket_opened: 'Ticket opened',
  ticket_updated: 'Ticket updated',
  ticket_closed: 'Ticket closed',
  giveaway_started: 'Giveaway started',
  giveaway_ended: 'Giveaway ended',
  giveaway_rerolled: 'Giveaway rerolled',
  bot_warning: 'Bot warnings',
  bot_error: 'Bot errors',
}

/** One-line description per type, shown under the label in preference toggles. */
export const TYPE_DESCRIPTIONS: Record<NotificationType, string> = {
  member_join: 'A new member joins the server.',
  member_leave: 'A member leaves or is removed.',
  mod_action: 'Bans, kicks, timeouts and warnings.',
  role_created: 'A new role is added.',
  role_updated: 'Role name, color, or permissions change.',
  role_deleted: 'A role is removed.',
  event_created: 'A scheduled event is created.',
  event_updated: 'An event is rescheduled or edited.',
  event_deleted: 'An event is cancelled or deleted.',
  channel_created: 'A new channel is added.',
  channel_updated: 'Channel name, topic, or settings change.',
  channel_deleted: 'A channel is removed.',
  server_settings_changed: 'Name, icon, verification, or AFK channel changes.',
  automation_saved: 'Welcome, goodbye, or auto-role config saved.',
  automation_triggered: 'An automation runs in response to an event.',
  ticket_opened: 'A member opens a support ticket.',
  ticket_updated: 'A ticket is claimed, assigned, or changed.',
  ticket_closed: 'A support ticket is closed.',
  giveaway_started: 'A giveaway goes live in the server.',
  giveaway_ended: 'A giveaway ends and winners are drawn.',
  giveaway_rerolled: 'New winners are drawn for a giveaway.',
  bot_warning: 'Recoverable issues like failed welcome messages.',
  bot_error: 'Critical bot failures that need attention.',
}
