'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import {
  serialiseInviteSettings,
  normaliseInviteSettings,
  type InviteConfig,
} from '@/lib/invites'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/invites`)
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function saveInviteSettings(guildId: string, config: InviteConfig): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  // Re-normalise server-side so a tampered payload can't persist bad values.
  const { enabled, settings } = serialiseInviteSettings(normaliseInviteSettings({ enabled: config.enabled, settings: config }))
  const { error } = await supabase
    .from('invite_settings')
    .upsert(
      { guild_id: guildId, enabled, settings, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )
  if (error) return { ok: false, error: `Failed to save: ${error.message}` }

  revalidate(guildId)
  return { ok: true }
}

// ── Manual admin management (all audited via invite_adjustments) ────────────────

async function audit(
  guildId: string,
  moderator: { userId: string; username: string | null; handle: string | null },
  row: {
    kind: 'bonus' | 'invalidate' | 'approve' | 'reset'
    userId: string | null
    userName: string | null
    amount?: number
    targetUserId?: string | null
    targetName?: string | null
    reason?: string | null
  },
) {
  const supabase = await createClient()
  await supabase.from('invite_adjustments').insert({
    guild_id: guildId,
    user_id: row.userId,
    user_name: row.userName,
    kind: row.kind,
    amount: row.amount ?? 0,
    target_user_id: row.targetUserId ?? null,
    target_name: row.targetName ?? null,
    reason: row.reason ?? null,
    created_by: moderator.userId,
    created_by_name: moderator.username,
  })
}

/** Add (or remove, with a negative amount) bonus invite credits for an inviter. */
export async function adjustBonusCredits(
  guildId: string,
  userId: string,
  userName: string | null,
  amount: number,
  reason: string | null,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  if (!userId) return { ok: false, error: 'Pick an inviter to credit.' }
  const delta = Math.trunc(Number(amount))
  if (!Number.isFinite(delta) || delta === 0) return { ok: false, error: 'Enter a non-zero amount.' }
  if (Math.abs(delta) > 100_000) return { ok: false, error: 'That amount is too large.' }

  await audit(guildId, auth.moderator, { kind: 'bonus', userId, userName, amount: delta, reason })
  revalidate(guildId)
  return { ok: true }
}

/** Invalidate or approve an attributed join. `approve` forces it back to valid. */
export async function setInviteValidity(
  guildId: string,
  memberUserId: string,
  approve: boolean,
  reason: string | null,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { data: member } = await supabase
    .from('invited_members')
    .select('user_id, user_name, inviter_id, inviter_name')
    .eq('guild_id', guildId)
    .eq('user_id', memberUserId)
    .maybeSingle()
  if (!member) return { ok: false, error: 'That member is no longer tracked.' }

  const { error } = await supabase
    .from('invited_members')
    .update({
      status: approve ? 'valid' : 'invalid',
      fake_reason: approve ? 'admin_approved' : 'admin_invalidated',
      updated_at: new Date().toISOString(),
    })
    .eq('guild_id', guildId)
    .eq('user_id', memberUserId)
  if (error) return { ok: false, error: error.message }

  await audit(guildId, auth.moderator, {
    kind: approve ? 'approve' : 'invalidate',
    userId: member.inviter_id,
    userName: member.inviter_name,
    targetUserId: member.user_id,
    targetName: member.user_name,
    reason,
  })
  await recordNotification({
    guildId,
    type: approve ? 'invite_valid' : 'invite_invalid',
    severity: 'info',
    title: `${member.user_name ?? 'A join'} ${approve ? 'approved' : 'invalidated'} by ${auth.moderator.username ?? 'an admin'}`,
    body: reason ?? undefined,
    link: `/dashboard/${guildId}/invites`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: member.user_id,
    targetName: member.user_name,
  })

  revalidate(guildId)
  return { ok: true }
}

/** Reset an inviter's stats: clears their attributed joins and bonuses. */
export async function resetInviterStats(guildId: string, userId: string, userName: string | null): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  if (!userId) return { ok: false, error: 'Pick an inviter to reset.' }

  const supabase = await createClient()
  await Promise.all([
    supabase.from('invited_members').delete().eq('guild_id', guildId).eq('inviter_id', userId),
    supabase.from('invite_adjustments').delete().eq('guild_id', guildId).eq('user_id', userId).eq('kind', 'bonus'),
  ])
  await audit(guildId, auth.moderator, { kind: 'reset', userId, userName, reason: 'Invite stats reset' })

  revalidate(guildId)
  return { ok: true }
}
