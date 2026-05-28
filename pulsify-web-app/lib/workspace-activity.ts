import 'server-only'
import { createClient } from '@/lib/supabase-server'
import { categoryForAction, type ActivityCategory } from '@/lib/workspace'

/**
 * Append a row to workspace_activity — the audit log + activity feed.
 *
 * Best-effort, exactly like recordNotification in lib/notifications-server.ts:
 * a failure here is logged and swallowed so it never breaks the action that
 * triggered it. Called from every mutating workspace server action.
 */
export type RecordActivityInput = {
  workspaceId: string
  actorId?: string | null
  actorName?: string | null
  /** Dotted verb: server.added, member.invited, note.created, task.completed … */
  action: string
  /** Defaults to the category derived from the action prefix. */
  category?: ActivityCategory
  targetType?: string | null
  targetId?: string | null
  /** Human-readable line shown in the feed. */
  summary?: string | null
  guildId?: string | null
  metadata?: Record<string, unknown>
}

export async function recordWorkspaceActivity(input: RecordActivityInput): Promise<void> {
  try {
    const supabase = await createClient()
    const { error } = await supabase.from('workspace_activity').insert({
      workspace_id: input.workspaceId,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
      action: input.action,
      category: input.category ?? categoryForAction(input.action),
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      summary: input.summary ? input.summary.slice(0, 300) : null,
      guild_id: input.guildId ?? null,
      metadata: input.metadata ?? {},
    })
    if (error) console.error('[workspace-activity] insert failed', error)
  } catch (e) {
    console.error('[workspace-activity] insert threw', e)
  }
}
