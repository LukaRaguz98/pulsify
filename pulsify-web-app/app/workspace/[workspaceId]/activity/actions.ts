'use server'

import { createClient } from '@/lib/supabase-server'
import { authorizeWorkspaceMember } from '@/lib/workspace-auth'

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Persist a member's per-workspace feed category filter. `enabledCategories`
 * is a map of category → boolean; missing keys default to ON in the UI.
 */
export async function saveFeedPrefs(
  workspaceId: string,
  enabledCategories: Record<string, boolean>,
): Promise<ActionResult> {
  const auth = await authorizeWorkspaceMember(workspaceId, 'viewActivity')
  if (!auth.ok) return auth
  const supabase = await createClient()
  const { error } = await supabase.from('workspace_notification_prefs').upsert(
    {
      workspace_id: workspaceId,
      user_id: auth.actor.userId,
      enabled_categories: enabledCategories,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,user_id' },
  )
  if (error) return { ok: false, error: 'Could not save your preferences.' }
  return { ok: true }
}
