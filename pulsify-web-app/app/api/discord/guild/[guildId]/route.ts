import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import { fetchGuild, fetchGuildFresh, modifyGuild, type GuildMutation } from '@/lib/discord'

const VERIFICATION_LEVELS = new Set([0, 1, 2, 3, 4])
const NOTIFICATIONS = new Set([0, 1])
const EXPLICIT_FILTERS = new Set([0, 1, 2])
// Discord only accepts these specific values for AFK timeout.
const AFK_TIMEOUTS = new Set([60, 300, 900, 1800, 3600])
const ICON_DATA_URI = /^data:image\/(png|jpe?g|gif|webp);base64,/i

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { guildId } = await params
  const guild = await fetchGuild(guildId)

  if (!guild) {
    return NextResponse.json({ error: 'Guild not found or bot not installed' }, { status: 404 })
  }

  return NextResponse.json(guild)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Partial<GuildMutation> & { reason?: string }
  const mutation: GuildMutation = {}

  if (body.name !== undefined) {
    const trimmed = body.name?.trim()
    if (!trimmed || trimmed.length < 2 || trimmed.length > 100) {
      return NextResponse.json(
        { error: 'Server name must be 2–100 characters.' },
        { status: 400 },
      )
    }
    mutation.name = trimmed
  }

  if (body.icon !== undefined) {
    if (body.icon !== null && !ICON_DATA_URI.test(body.icon)) {
      return NextResponse.json(
        { error: 'Icon must be a PNG, JPEG, GIF, or WEBP data URI.' },
        { status: 400 },
      )
    }
    mutation.icon = body.icon
  }

  if (body.verification_level !== undefined) {
    if (!VERIFICATION_LEVELS.has(body.verification_level)) {
      return NextResponse.json({ error: 'Invalid verification level.' }, { status: 400 })
    }
    mutation.verification_level = body.verification_level
  }

  if (body.default_message_notifications !== undefined) {
    if (!NOTIFICATIONS.has(body.default_message_notifications)) {
      return NextResponse.json({ error: 'Invalid notification setting.' }, { status: 400 })
    }
    mutation.default_message_notifications = body.default_message_notifications
  }

  if (body.explicit_content_filter !== undefined) {
    if (!EXPLICIT_FILTERS.has(body.explicit_content_filter)) {
      return NextResponse.json({ error: 'Invalid explicit content filter.' }, { status: 400 })
    }
    mutation.explicit_content_filter = body.explicit_content_filter
  }

  if (body.afk_channel_id !== undefined) mutation.afk_channel_id = body.afk_channel_id
  if (body.afk_timeout !== undefined) {
    if (!AFK_TIMEOUTS.has(body.afk_timeout)) {
      return NextResponse.json(
        { error: 'AFK timeout must be 1, 5, 15, 30, or 60 minutes.' },
        { status: 400 },
      )
    }
    mutation.afk_timeout = body.afk_timeout
  }
  if (body.system_channel_id !== undefined) mutation.system_channel_id = body.system_channel_id
  if (body.rules_channel_id !== undefined) mutation.rules_channel_id = body.rules_channel_id
  if (body.public_updates_channel_id !== undefined) {
    mutation.public_updates_channel_id = body.public_updates_channel_id
  }

  if (Object.keys(mutation).length === 0) {
    return NextResponse.json({ error: 'No changes provided.' }, { status: 400 })
  }

  const result = await modifyGuild(guildId, mutation, body.reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  // Re-fetch with `with_counts=true` so the response includes member counts
  // (PATCH /guilds/:id never returns them).
  const fresh = await fetchGuildFresh(guildId)

  const changedKeys = Object.keys(mutation)
  await recordNotification({
    guildId,
    type: 'server_settings_changed',
    title: `${auth.moderator.username ?? 'A moderator'} updated server settings`,
    body: changedKeys.length === 1
      ? `Changed ${changedKeys[0].replace(/_/g, ' ')}`
      : `Changed ${changedKeys.length} settings`,
    link: `/dashboard/${guildId}/server-settings`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: guildId,
    targetName: fresh?.name ?? result.guild.name,
    metadata: { changed_keys: changedKeys },
  })
  return NextResponse.json(fresh ?? result.guild)
}
