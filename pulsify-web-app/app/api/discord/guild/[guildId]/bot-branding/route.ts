import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import {
  checkBotPermissions,
  fetchBotGuildMember,
  getBotUser,
  guildMemberAvatarUrl,
  modifyBotGuildMember,
  avatarUrl as globalAvatarUrl,
} from '@/lib/discord'
import type { BotBrandingResponse } from '@/lib/bot-branding'

// Same accepted image formats as the server-icon flow, kept in sync on purpose.
const AVATAR_DATA_URI = /^data:image\/(png|jpe?g|gif|webp);base64,/i
// Discord accepts large avatars, but we cap the upload to keep requests sane.
// ~1.4 M chars of base64 ≈ 1 MB of image, matching the client-side ceiling.
const MAX_AVATAR_CHARS = 1_400_000
const MAX_NICK_LEN = 32

type BrandingRow = {
  bot_nickname: string | null
  avatar_hash: string | null
  updated_at: string
  updated_by_name: string | null
}

async function loadRow(guildId: string): Promise<BrandingRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('guild_bot_branding')
    .select('bot_nickname, avatar_hash, updated_at, updated_by_name')
    .eq('guild_id', guildId)
    .maybeSingle()
  return (data as BrandingRow | null) ?? null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId } = await params

  const [member, botUser, perms, row] = await Promise.all([
    fetchBotGuildMember(guildId),
    getBotUser(),
    checkBotPermissions(guildId),
    loadRow(guildId),
  ])

  const defaultName = botUser?.global_name ?? botUser?.username ?? 'Pulse'
  const defaultAvatar = botUser
    ? globalAvatarUrl(botUser.id, botUser.avatar, '0', 128) || null
    : null

  const nickname = member?.nick ?? null
  const guildAvatar =
    member && member.avatar
      ? guildMemberAvatarUrl(guildId, member.user.id, member.avatar, 128) || null
      : null

  const response: BotBrandingResponse = {
    current: { nickname, avatarUrl: guildAvatar },
    default: { name: defaultName, avatarUrl: defaultAvatar },
    permissions: {
      inGuild: perms?.inGuild ?? Boolean(member),
      // null perms = couldn't determine → don't block; let Discord enforce.
      canChangeNickname: perms === null ? true : perms.changeNickname,
      canChangeAvatar: perms === null ? true : perms.inGuild,
    },
    hasCustomBranding: Boolean(nickname || guildAvatar),
    lastUpdated: row ? { at: row.updated_at, by: row.updated_by_name } : null,
  }

  return NextResponse.json(response)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    nickname?: string | null
    avatar?: string | null
  }

  const mutation: { nick?: string | null; avatar?: string | null } = {}

  if (body.nickname !== undefined) {
    if (body.nickname === null || body.nickname.trim() === '') {
      mutation.nick = null
    } else {
      const trimmed = body.nickname.trim()
      if (trimmed.length > MAX_NICK_LEN) {
        return NextResponse.json(
          { error: `Bot name must be ${MAX_NICK_LEN} characters or fewer.` },
          { status: 400 },
        )
      }
      mutation.nick = trimmed
    }
  }

  if (body.avatar !== undefined) {
    if (body.avatar === null) {
      mutation.avatar = null
    } else {
      if (!AVATAR_DATA_URI.test(body.avatar)) {
        return NextResponse.json(
          { error: 'Avatar must be a PNG, JPEG, GIF, or WEBP image.' },
          { status: 400 },
        )
      }
      if (body.avatar.length > MAX_AVATAR_CHARS) {
        return NextResponse.json(
          { error: 'Avatar image is too large. Use an image under 1 MB.' },
          { status: 400 },
        )
      }
      mutation.avatar = body.avatar
    }
  }

  if (mutation.nick === undefined && mutation.avatar === undefined) {
    return NextResponse.json({ error: 'No branding changes provided.' }, { status: 400 })
  }

  // Permission gate: changing the bot's own nickname needs Change Nickname.
  // null perms = couldn't determine → don't block, let Discord enforce.
  if (mutation.nick !== undefined) {
    const perms = await checkBotPermissions(guildId)
    if (perms && !perms.changeNickname) {
      return NextResponse.json(
        { error: 'The Pulse bot is missing the "Change Nickname" permission on this server.' },
        { status: 403 },
      )
    }
  }

  const result = await modifyBotGuildMember(guildId, mutation, `Bot branding updated by ${auth.moderator.username ?? 'a moderator'}`)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  const member = result.member
  const supabase = await createClient()
  await supabase.from('guild_bot_branding').upsert(
    {
      guild_id: guildId,
      bot_nickname: member.nick ?? null,
      avatar_hash: member.avatar ?? null,
      updated_at: new Date().toISOString(),
      updated_by: auth.moderator.userId,
      updated_by_name: auth.moderator.username,
    },
    { onConflict: 'guild_id' },
  )

  const changed: string[] = []
  if (mutation.nick !== undefined) changed.push('name')
  if (mutation.avatar !== undefined) changed.push('avatar')
  await recordNotification({
    guildId,
    type: 'server_settings_changed',
    severity: 'info',
    title: `${auth.moderator.username ?? 'A moderator'} updated the bot's branding`,
    body:
      `Changed bot ${changed.join(' and ')}` +
      (member.nick ? ` · now "${member.nick}"` : ' · reset name to default'),
    link: `/dashboard/${guildId}/server-settings`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: guildId,
    metadata: { changed, nickname: member.nick ?? null },
  })

  return NextResponse.json({
    current: {
      nickname: member.nick ?? null,
      avatarUrl:
        member.avatar
          ? guildMemberAvatarUrl(guildId, member.user.id, member.avatar, 128) || null
          : null,
    },
    lastUpdated: { at: new Date().toISOString(), by: auth.moderator.username },
  })
}
