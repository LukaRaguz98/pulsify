import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TempRoleEventAction, TempRoleSource } from './temporary-roles'

export type TempRoleEventInput = {
  guildId: string
  temporaryRoleId: string | null
  userId: string
  userName?: string | null
  roleId: string
  roleName?: string | null
  action: TempRoleEventAction
  source?: TempRoleSource
  actorId?: string | null
  actorName?: string | null
  detail?: Record<string, unknown>
}

/**
 * Append one row to the temporary_role_events audit log. Best-effort: a logging
 * failure must never roll back the role action that triggered it, so errors are
 * swallowed and logged.
 */
export async function recordTempRoleEvent(
  supabase: SupabaseClient,
  e: TempRoleEventInput,
): Promise<void> {
  try {
    const { error } = await supabase.from('temporary_role_events').insert({
      guild_id: e.guildId,
      temporary_role_id: e.temporaryRoleId,
      user_id: e.userId,
      user_name: e.userName ?? null,
      role_id: e.roleId,
      role_name: e.roleName ?? null,
      action: e.action,
      source: e.source ?? 'manual',
      actor_id: e.actorId ?? null,
      actor_name: e.actorName ?? null,
      detail: e.detail ?? {},
    })
    if (error) console.error('[temporary-roles] event insert failed', error)
  } catch (err) {
    console.error('[temporary-roles] event insert threw', err)
  }
}
