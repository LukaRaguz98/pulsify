import 'server-only'
import { createClient } from '@/lib/supabase-server'
import {
  TYPE_TO_CATEGORY,
  TYPE_TO_SEVERITY,
  type NotificationSeverity,
  type NotificationType,
} from '@/lib/notifications'

export type RecordNotificationInput = {
  guildId: string
  type: NotificationType
  title: string
  body?: string | null
  /** Override the default severity for the type. */
  severity?: NotificationSeverity
  /** Dashboard route opened when the notification is clicked. */
  link?: string | null
  /** Who triggered the event — usually a moderator's Discord ID. */
  actorId?: string | null
  /** Display name used in titles / lists (server nickname → global name → username). */
  actorName?: string | null
  /** Raw @handle, rendered next to the display name in the detail view. */
  actorUsername?: string | null
  /** The entity the event is about — member, channel, role, etc. */
  targetId?: string | null
  targetName?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Insert a notification row. Best-effort: errors are swallowed and logged so a
 * failure here never bubbles up and breaks the action that triggered it.
 *
 * Member join/leave notifications are NOT created via this function — they
 * come from the analytics_events trigger so the bot can stay agnostic.
 */
export async function recordNotification(input: RecordNotificationInput): Promise<void> {
  try {
    const supabase = await createClient()
    const { error } = await supabase.from('notifications').insert({
      guild_id: input.guildId,
      type: input.type,
      category: TYPE_TO_CATEGORY[input.type],
      severity: input.severity ?? TYPE_TO_SEVERITY[input.type],
      title: input.title.slice(0, 200),
      body: input.body ? input.body.slice(0, 1000) : null,
      link: input.link ?? null,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
      actor_username: input.actorUsername ?? null,
      target_id: input.targetId ?? null,
      target_name: input.targetName ?? null,
      metadata: input.metadata ?? {},
    })
    if (error) console.error('[notifications] insert failed', error)
  } catch (e) {
    console.error('[notifications] insert threw', e)
  }
}
