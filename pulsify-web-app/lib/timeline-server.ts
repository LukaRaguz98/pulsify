import 'server-only'
import { createClient } from '@/lib/supabase-server'
import {
  TIMELINE_EVENTS,
  eventDef,
  type TimelineEventType,
  type TimelineSeverity,
  type TimelineSource,
  type TimelineTargetType,
  type AffectedUser,
} from '@/lib/timeline'
import type { NotificationType } from '@/lib/notifications'

/**
 * Server-only writer for the Server Timeline (PULSIFY-63).
 *
 * Two ways in:
 *
 *   1. `recordTimelineEvent(...)` — an explicit emit. Use this whenever you
 *      have something the timeline should remember that a notification either
 *      doesn't cover or covers too thinly (a settings diff, a Pulse Guard
 *      detection, a nickname change).
 *
 *   2. The MIRROR — `recordNotification` (lib/notifications-server.ts) calls
 *      `mirrorNotificationToTimeline` for every notification whose type maps
 *      to a timeline event. That's ~80 existing call sites feeding history for
 *      free, and it means a new notification type is one map entry away from
 *      appearing in the timeline too.
 *
 * Both are best-effort: the timeline is a record, never a dependency. An
 * insert failure logs and returns rather than breaking the action that caused
 * the event.
 */

export type RecordTimelineInput = {
  guildId: string
  type: TimelineEventType
  /** Human-readable one-liner. Names are baked in at record time. */
  title: string
  description?: string | null
  /** Overrides the catalog default (e.g. a warning-level settings change). */
  severity?: TimelineSeverity
  /** Where the change came from. Defaults to 'dashboard'. */
  source?: TimelineSource
  /** Overrides the catalog default — for events a module can't be inferred from. */
  module?: string | null
  actorId?: string | null
  actorName?: string | null
  actorUsername?: string | null
  targetId?: string | null
  targetName?: string | null
  targetType?: TimelineTargetType | null
  /** The state before the change. Omit for non-mutations. */
  previousValue?: Record<string, unknown> | null
  /** The state after the change. */
  newValue?: Record<string, unknown> | null
  /** Members touched beyond the target (giveaway winners, bulk grants). */
  affectedUsers?: AffectedUser[]
  metadata?: Record<string, unknown>
  /** Dashboard route the card's "Open" action navigates to. */
  link?: string | null
}

const TITLE_MAX = 300
const DESCRIPTION_MAX = 2000
/** Cap the affected-user list so one raid can't write a megabyte-wide row. */
const AFFECTED_USERS_MAX = 100

/**
 * Insert one timeline event. Defaults for category/module/severity/targetType
 * come from the catalog so a caller only spells out what's specific to this
 * occurrence.
 */
export async function recordTimelineEvent(input: RecordTimelineInput): Promise<void> {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from('timeline_events')
      .insert(buildTimelineRow(input))
    if (error) console.error('[timeline] insert failed', error)
  } catch (e) {
    console.error('[timeline] insert threw', e)
  }
}

/**
 * Insert several events at once — used by flows that produce a burst (applying
 * a template flips a handful of modules, restoring a backup rewrites several
 * config areas). One round trip, same best-effort contract.
 */
export async function recordTimelineEvents(inputs: RecordTimelineInput[]): Promise<void> {
  if (inputs.length === 0) return
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from('timeline_events')
      .insert(inputs.map(buildTimelineRow))
    if (error) console.error('[timeline] batch insert failed', error)
  } catch (e) {
    console.error('[timeline] batch insert threw', e)
  }
}

function buildTimelineRow(input: RecordTimelineInput) {
  const def = TIMELINE_EVENTS[input.type]
  return {
    guild_id: input.guildId,
    category: def.category,
    event_type: input.type,
    module: input.module !== undefined ? input.module : def.module,
    severity: input.severity ?? def.severity,
    source: input.source ?? 'dashboard',
    title: input.title.slice(0, TITLE_MAX),
    description: input.description ? input.description.slice(0, DESCRIPTION_MAX) : null,
    actor_id: input.actorId ?? null,
    actor_name: input.actorName ?? null,
    actor_username: input.actorUsername ?? null,
    target_id: input.targetId ?? null,
    target_name: input.targetName ?? null,
    target_type: input.targetType !== undefined ? input.targetType : def.targetType,
    previous_value: input.previousValue ?? null,
    new_value: input.newValue ?? null,
    affected_users: (input.affectedUsers ?? []).slice(0, AFFECTED_USERS_MAX),
    metadata: input.metadata ?? {},
    link: input.link ?? null,
  }
}

// ── Notification mirror ──────────────────────────────────────────────────

/**
 * Notification type → timeline event type.
 *
 * Only types that represent a *change worth remembering* are listed. The
 * deliberate omissions are the noisy per-member signals that would drown the
 * history without telling an admin anything about how the server evolved:
 *
 *   • `level_up` — every member levels constantly; that story lives in Levels.
 *   • `invite_valid` / `invite_invalid` — scoring churn on a single join.
 *     The join itself is already recorded as `member_invited`.
 *   • `bot_warning` — recoverable, self-healing noise (bot_error IS kept).
 *
 * A notification type missing from this map simply doesn't reach the timeline;
 * that's a supported outcome, not a bug.
 */
const NOTIFICATION_TO_TIMELINE: Partial<Record<NotificationType, TimelineEventType>> = {
  member_join: 'member_joined',
  member_leave: 'member_left',
  mod_action: 'moderation_action',
  role_created: 'role_created',
  role_updated: 'role_updated',
  role_deleted: 'role_deleted',
  temp_role_assigned: 'temp_role_granted',
  temp_role_expired: 'temp_role_expired',
  temp_role_extended: 'temp_role_extended',
  event_created: 'event_created',
  event_updated: 'event_updated',
  event_deleted: 'event_deleted',
  channel_created: 'channel_created',
  channel_updated: 'channel_updated',
  channel_deleted: 'channel_deleted',
  server_settings_changed: 'settings_changed',
  automation_saved: 'automation_updated',
  automation_triggered: 'automation_triggered',
  ticket_opened: 'ticket_opened',
  ticket_closed: 'ticket_closed',
  application_submitted: 'application_submitted',
  application_status_changed: 'application_status_changed',
  giveaway_started: 'giveaway_started',
  giveaway_ended: 'giveaway_ended',
  giveaway_rerolled: 'giveaway_rerolled',
  poll_started: 'poll_published',
  poll_closed: 'poll_closed',
  announcement_published: 'announcement_published',
  announcement_failed: 'announcement_failed',
  integration_connected: 'integration_connected',
  integration_disconnected: 'integration_disconnected',
  integration_error: 'integration_error',
  milestone_reached: 'member_milestone_reached',
  birthday_today: 'member_birthday',
  reward_purchased: 'economy_purchase',
  security_alert: 'security_alert',
  security_mitigation: 'security_mitigation',
  security_recovered: 'security_recovered',
  alt_risk_flagged: 'alt_risk_flagged',
  invite_joined: 'member_invited',
  invite_reward: 'economy_reward_granted',
  invite_spike: 'security_alert',
  bot_error: 'bot_error',
  // Deliberately unmapped — see the doc comment above.
  // level_up, invite_valid, invite_invalid, ticket_updated, bot_warning
}

/** Notification types the timeline mirrors. Exported for tests + docs. */
export function timelineTypeForNotification(
  type: NotificationType,
): TimelineEventType | null {
  return NOTIFICATION_TO_TIMELINE[type] ?? null
}

export type MirrorInput = {
  guildId: string
  type: NotificationType
  title: string
  body?: string | null
  link?: string | null
  actorId?: string | null
  actorName?: string | null
  actorUsername?: string | null
  targetId?: string | null
  targetName?: string | null
  metadata?: Record<string, unknown>
  /** Where the notification originated. Dashboard writes default correctly. */
  source?: TimelineSource
}

/**
 * Mirror a notification into the timeline, if its type maps to an event.
 *
 * The notification's own fields carry over verbatim; before/after values are
 * left null (a notification never had them). When a call site can produce a
 * real diff, prefer an explicit `recordTimelineEvent` alongside — pass
 * `timeline: false` on the notification to avoid a duplicate row.
 */
export async function mirrorNotificationToTimeline(input: MirrorInput): Promise<void> {
  const type = timelineTypeForNotification(input.type)
  if (!type) return
  const def = eventDef(type)
  await recordTimelineEvent({
    guildId: input.guildId,
    type,
    title: input.title,
    description: input.body ?? null,
    source: input.source ?? 'dashboard',
    actorId: input.actorId,
    actorName: input.actorName,
    actorUsername: input.actorUsername,
    targetId: input.targetId,
    targetName: input.targetName,
    targetType: def?.targetType ?? null,
    metadata: input.metadata,
    link: input.link,
  })
}
