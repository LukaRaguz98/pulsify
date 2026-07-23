'use server'

import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import {
  unbanUser,
  banGuildMember,
  kickGuildMember,
  timeoutMemberDiscord,
  clearMemberTimeoutDiscord,
  setMemberNicknameDiscord,
  addMemberRoleDiscord,
  removeMemberRoleDiscord,
  deleteChannelMessage,
  bulkDeleteChannelMessages,
  checkBotPermissions,
  checkBotCanAct,
} from '@/lib/discord'

export type ActionResult = { ok: true } | { ok: false; error: string }

/** Target user identity passed to every member-targeted action. */
export type ActionTarget = {
  id: string
  /** Server nickname or Discord global_name; null if neither is set. */
  displayName: string | null
  /** The actual @username. */
  username: string | null
}

type LogParams = {
  guildId: string
  action: string
  target?: ActionTarget | null
  reason?: string | null
  metadata?: Record<string, unknown>
}

const ACTION_LABELS: Record<string, string> = {
  ban: 'banned',
  unban: 'unbanned',
  kick: 'kicked',
  timeout: 'timed out',
  remove_timeout: 'removed timeout from',
  warn: 'warned',
  nickname: 'set the nickname of',
  add_role: 'added a role to',
  remove_role: 'removed a role from',
  delete_message: 'deleted a message from',
  bulk_delete_messages: 'bulk-deleted messages from',
  // Channel operations, written by the bot's /channel commands (PULSIFY-61).
  // Listed here so the activity feed renders them properly when it reads a row
  // this file didn't write — they have no target member, so the phrasing stands
  // alone. Keep in lock-step with ACTION_LABELS in pulse-bot/src/moderation-log.js.
  channel_lock: 'locked a channel',
  channel_unlock: 'unlocked a channel',
  channel_slowmode: "changed a channel's slowmode",
}

async function recordLog(
  moderatorId: string,
  moderatorUsername: string | null,
  moderatorHandle: string | null,
  params: LogParams,
) {
  const supabase = await createClient()
  await supabase.from('moderation_logs').insert({
    guild_id: params.guildId,
    action: params.action,
    target_user_id: params.target?.id ?? null,
    target_username: params.target?.username ?? null,
    target_display_name: params.target?.displayName ?? null,
    moderator_id: moderatorId,
    moderator_username: moderatorUsername,
    reason: params.reason ?? null,
    metadata: params.metadata ?? {},
  })

  // Fire-and-forget notification so the activity feed reflects mod actions in
  // real time. recordNotification swallows errors so a failure here never
  // blocks the underlying moderation action.
  const actionLabel = ACTION_LABELS[params.action] ?? params.action.replace(/_/g, ' ')
  const targetLabel = params.target?.displayName ?? params.target?.username ?? null
  const title = targetLabel
    ? `${moderatorUsername ?? 'Moderator'} ${actionLabel} ${targetLabel}`
    : `${moderatorUsername ?? 'Moderator'} ${actionLabel}`
  await recordNotification({
    guildId: params.guildId,
    type: 'mod_action',
    severity: params.action === 'ban' ? 'error' : params.action === 'warn' ? 'warning' : 'info',
    title,
    body: params.reason ?? null,
    link: `/dashboard/${params.guildId}/moderation`,
    actorId: moderatorId,
    actorName: moderatorUsername,
    actorUsername: moderatorHandle,
    targetId: params.target?.id ?? null,
    targetName: targetLabel,
    metadata: { action: params.action, ...(params.metadata ?? {}) },
  })
}

function failed(error: string): ActionResult {
  return { ok: false, error }
}

type BotPermKey =
  | 'banMembers'
  | 'kickMembers'
  | 'moderateMembers'
  | 'manageNicknames'
  | 'manageRoles'
  | 'manageMessages'
  | 'sendMessages'

const BOT_PERM_LABELS: Record<BotPermKey, string> = {
  banMembers: 'Ban Members',
  kickMembers: 'Kick Members',
  moderateMembers: 'Moderate Members',
  manageNicknames: 'Manage Nicknames',
  manageRoles: 'Manage Roles',
  manageMessages: 'Manage Messages',
  sendMessages: 'Send Messages',
}

async function requireBotPerm(guildId: string, needed: BotPermKey): Promise<ActionResult> {
  const perms = await checkBotPermissions(guildId)
  // Perms unknown — don't block; Discord will reject with a clear message if
  // the bot really lacks the permission.
  if (perms === null) return { ok: true }
  if (!perms.inGuild) return failed('Bot is not in this server.')
  if (perms.administrator) return { ok: true }
  if (!perms[needed]) {
    return failed(
      `Bot is missing the "${BOT_PERM_LABELS[needed]}" permission. Re-invite the bot with the required permissions.`,
    )
  }
  return { ok: true }
}

async function requireHierarchy(guildId: string, targetUserId: string): Promise<ActionResult> {
  const check = await checkBotCanAct(guildId, targetUserId)
  return check.ok ? { ok: true } : failed(check.reason)
}

// ---- Bans -------------------------------------------------------------

export async function unbanMember(
  guildId: string,
  target: ActionTarget,
  reason?: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return failed(auth.error)

  const botCheck = await requireBotPerm(guildId, 'banMembers')
  if (!botCheck.ok) return botCheck

  const result = await unbanUser(guildId, target.id, reason)
  if (!result.ok) return failed(result.error)

  await recordLog(auth.moderator.userId, auth.moderator.username, auth.moderator.handle, {
    guildId,
    action: 'unban',
    target,
    reason,
  })
  return { ok: true }
}

export async function banMember(
  guildId: string,
  target: ActionTarget,
  opts: { reason?: string; deleteMessageSeconds?: number } = {},
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return failed(auth.error)

  const botCheck = await requireBotPerm(guildId, 'banMembers')
  if (!botCheck.ok) return botCheck

  const hierarchy = await requireHierarchy(guildId, target.id)
  if (!hierarchy.ok) return hierarchy

  const result = await banGuildMember(guildId, target.id, opts)
  if (!result.ok) return failed(result.error)

  await recordLog(auth.moderator.userId, auth.moderator.username, auth.moderator.handle, {
    guildId,
    action: 'ban',
    target,
    reason: opts.reason,
    metadata: opts.deleteMessageSeconds
      ? { delete_message_seconds: opts.deleteMessageSeconds }
      : {},
  })
  return { ok: true }
}

// ---- Kick / Timeout / Nickname ---------------------------------------

export async function kickMember(
  guildId: string,
  target: ActionTarget,
  reason?: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return failed(auth.error)

  const botCheck = await requireBotPerm(guildId, 'kickMembers')
  if (!botCheck.ok) return botCheck

  const hierarchy = await requireHierarchy(guildId, target.id)
  if (!hierarchy.ok) return hierarchy

  const result = await kickGuildMember(guildId, target.id, reason)
  if (!result.ok) return failed(result.error)

  await recordLog(auth.moderator.userId, auth.moderator.username, auth.moderator.handle, {
    guildId,
    action: 'kick',
    target,
    reason,
  })
  return { ok: true }
}

export async function timeoutMember(
  guildId: string,
  target: ActionTarget,
  durationMinutes: number,
  reason?: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return failed(auth.error)

  const botCheck = await requireBotPerm(guildId, 'moderateMembers')
  if (!botCheck.ok) return botCheck

  const hierarchy = await requireHierarchy(guildId, target.id)
  if (!hierarchy.ok) return hierarchy

  const minutes = Math.max(1, Math.min(40320, Math.floor(durationMinutes)))
  const until = new Date(Date.now() + minutes * 60_000).toISOString()

  const result = await timeoutMemberDiscord(guildId, target.id, until, reason)
  if (!result.ok) return failed(result.error)

  await recordLog(auth.moderator.userId, auth.moderator.username, auth.moderator.handle, {
    guildId,
    action: 'timeout',
    target,
    reason,
    metadata: { duration_minutes: minutes, until },
  })
  return { ok: true }
}

export async function removeMemberTimeout(
  guildId: string,
  target: ActionTarget,
  reason?: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return failed(auth.error)

  const botCheck = await requireBotPerm(guildId, 'moderateMembers')
  if (!botCheck.ok) return botCheck

  const hierarchy = await requireHierarchy(guildId, target.id)
  if (!hierarchy.ok) return hierarchy

  const result = await clearMemberTimeoutDiscord(guildId, target.id, reason)
  if (!result.ok) return failed(result.error)

  await recordLog(auth.moderator.userId, auth.moderator.username, auth.moderator.handle, {
    guildId,
    action: 'remove_timeout',
    target,
    reason,
  })
  return { ok: true }
}

export async function setMemberNickname(
  guildId: string,
  target: ActionTarget,
  nickname: string,
  reason?: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return failed(auth.error)

  const botCheck = await requireBotPerm(guildId, 'manageNicknames')
  if (!botCheck.ok) return botCheck

  const hierarchy = await requireHierarchy(guildId, target.id)
  if (!hierarchy.ok) return hierarchy

  const trimmed = nickname.trim()
  const value = trimmed.length === 0 ? null : trimmed.slice(0, 32)

  const result = await setMemberNicknameDiscord(guildId, target.id, value, reason)
  if (!result.ok) return failed(result.error)

  await recordLog(auth.moderator.userId, auth.moderator.username, auth.moderator.handle, {
    guildId,
    action: 'nickname',
    target,
    reason,
    metadata: { nickname: value },
  })
  return { ok: true }
}

// ---- Roles -----------------------------------------------------------

export async function addMemberRole(
  guildId: string,
  target: ActionTarget,
  roleId: string,
  roleName: string | null,
  reason?: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return failed(auth.error)

  const botCheck = await requireBotPerm(guildId, 'manageRoles')
  if (!botCheck.ok) return botCheck

  const hierarchy = await requireHierarchy(guildId, target.id)
  if (!hierarchy.ok) return hierarchy

  const result = await addMemberRoleDiscord(guildId, target.id, roleId, reason)
  if (!result.ok) return failed(result.error)

  await recordLog(auth.moderator.userId, auth.moderator.username, auth.moderator.handle, {
    guildId,
    action: 'add_role',
    target,
    reason,
    metadata: { role_id: roleId, role_name: roleName },
  })
  return { ok: true }
}

export async function removeMemberRole(
  guildId: string,
  target: ActionTarget,
  roleId: string,
  roleName: string | null,
  reason?: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return failed(auth.error)

  const botCheck = await requireBotPerm(guildId, 'manageRoles')
  if (!botCheck.ok) return botCheck

  const hierarchy = await requireHierarchy(guildId, target.id)
  if (!hierarchy.ok) return hierarchy

  const result = await removeMemberRoleDiscord(guildId, target.id, roleId, reason)
  if (!result.ok) return failed(result.error)

  await recordLog(auth.moderator.userId, auth.moderator.username, auth.moderator.handle, {
    guildId,
    action: 'remove_role',
    target,
    reason,
    metadata: { role_id: roleId, role_name: roleName },
  })
  return { ok: true }
}

// ---- Warnings --------------------------------------------------------

export async function warnMember(
  guildId: string,
  target: ActionTarget,
  reason: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return failed(auth.error)

  const trimmedReason = reason.trim()
  if (trimmedReason.length === 0) return failed('A reason is required for warnings.')

  const supabase = await createClient()
  // guild_warnings.username holds the display label rendered in older views,
  // so prefer the display name and fall back to username.
  const warnLabel = target.displayName ?? target.username
  const { error } = await supabase.from('guild_warnings').insert({
    guild_id: guildId,
    user_id: target.id,
    username: warnLabel,
    moderator_id: auth.moderator.userId,
    moderator_username: auth.moderator.username,
    reason: trimmedReason,
  })
  if (error) return failed(`Failed to record warning: ${error.message}`)

  await recordLog(auth.moderator.userId, auth.moderator.username, auth.moderator.handle, {
    guildId,
    action: 'warn',
    target,
    reason: trimmedReason,
  })
  return { ok: true }
}

// ---- Messages --------------------------------------------------------

export async function deleteSingleMessage(
  guildId: string,
  channelId: string,
  channelName: string | null,
  messageId: string,
  authorId: string | null,
  reason?: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return failed(auth.error)

  const botCheck = await requireBotPerm(guildId, 'manageMessages')
  if (!botCheck.ok) return botCheck

  const result = await deleteChannelMessage(channelId, messageId, reason)
  if (!result.ok) return failed(result.error)

  await recordLog(auth.moderator.userId, auth.moderator.username, auth.moderator.handle, {
    guildId,
    action: 'delete_message',
    target: authorId ? { id: authorId, displayName: null, username: null } : null,
    reason,
    metadata: { channel_id: channelId, channel_name: channelName, message_id: messageId },
  })
  return { ok: true }
}

export async function bulkDeleteMessages(
  guildId: string,
  channelId: string,
  channelName: string | null,
  messageIds: string[],
  reason?: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return failed(auth.error)
  if (messageIds.length === 0) return failed('Pick at least one message to delete.')

  const botCheck = await requireBotPerm(guildId, 'manageMessages')
  if (!botCheck.ok) return botCheck

  const result = await bulkDeleteChannelMessages(channelId, messageIds, reason)
  if (!result.ok) return failed(result.error)

  await recordLog(auth.moderator.userId, auth.moderator.username, auth.moderator.handle, {
    guildId,
    action: 'bulk_delete_messages',
    reason,
    metadata: {
      channel_id: channelId,
      channel_name: channelName,
      message_ids: messageIds,
      count: messageIds.length,
    },
  })
  return { ok: true }
}
