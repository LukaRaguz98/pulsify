import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import {
  fetchGuildMembers,
  fetchGuildRoles,
  fetchGuildChannels,
  fetchGuildEvents,
  avatarUrl,
} from '@/lib/discord'
import { getCommandCatalog } from '@/lib/commands-server'
import { ACTION_BY_TYPE, type ActionType } from '@/lib/automations'
import type { SearchIndex } from '@/lib/command-palette'

// Discord's member-list endpoint caps a single page at 1000; the directory uses
// the same ceiling, so search covers the same population.
const MEMBER_LIMIT = 1000
// Time-series tables are bounded to recent rows — enough to make search useful
// without shipping the whole history to the client on every palette open.
const MOD_LOG_LIMIT = 200
const NOTIFICATION_LIMIT = 100

/**
 * GET /api/guilds/[guildId]/search
 *
 * Returns a bounded snapshot ("index") of everything the global search can
 * match: members, roles, channels, events, commands, automations, recent
 * moderation logs and notifications. The client caches this for a short window
 * and fuzzy-matches locally, so per-keystroke typing never hits the network.
 *
 * Discord reads are served from Next's data cache (revalidate: 60), so repeated
 * opens within the window are cheap.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()

  const [members, roles, channels, events, catalog, configRes, automationRes, modLogRes, notifRes] =
    await Promise.all([
      fetchGuildMembers(guildId, MEMBER_LIMIT),
      fetchGuildRoles(guildId),
      fetchGuildChannels(guildId),
      // Events can throw on a transient Discord blip — never let that sink the
      // whole index; an empty events section is fine.
      fetchGuildEvents(guildId).catch(() => []),
      getCommandCatalog(),
      supabase.from('command_configs').select('command_name, enabled').eq('guild_id', guildId),
      supabase
        .from('scheduled_automations')
        .select('id, name, action_type, enabled')
        .eq('guild_id', guildId)
        .order('updated_at', { ascending: false }),
      supabase
        .from('moderation_logs')
        .select('id, action, target_username, target_display_name, moderator_username, reason, created_at')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: false })
        .limit(MOD_LOG_LIMIT),
      supabase
        .from('notifications')
        .select('id, title, body, category, link, created_at')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: false })
        .limit(NOTIFICATION_LIMIT),
    ])

  // Approximate per-role membership from the fetched member page — cheap and
  // good enough for a search subtitle.
  const roleCounts = new Map<string, number>()
  for (const m of members) {
    for (const rid of m.roles) roleCounts.set(rid, (roleCounts.get(rid) ?? 0) + 1)
  }

  const now = Date.now()
  const channelNameById = new Map(channels.map((c) => [c.id, c.name]))

  // Commands: catalog is the source of truth for what exists; a config row only
  // overrides the enabled flag (missing row = enabled).
  const disabledCommands = new Set(
    ((configRes.data ?? []) as { command_name: string; enabled: boolean }[])
      .filter((r) => r.enabled === false)
      .map((r) => r.command_name),
  )

  const index: SearchIndex = {
    members: members.map((m) => ({
      id: m.user.id,
      name: m.nick ?? m.user.global_name ?? m.user.username,
      handle: m.user.username,
      avatar: avatarUrl(m.user.id, m.user.avatar, '0', 32),
      bot: m.user.bot ?? false,
      inTimeout: m.communication_disabled_until
        ? new Date(m.communication_disabled_until).getTime() > now
        : false,
    })),
    roles: roles
      .filter((r) => r.name !== '@everyone')
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        memberHint: roleCounts.get(r.id) ?? 0,
      })),
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parent: c.parent_id ? channelNameById.get(c.parent_id) ?? null : null,
    })),
    events: events.map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status,
      start: e.scheduled_start_time,
      location: e.entity_metadata?.location ?? null,
    })),
    commands: catalog.map((c) => ({
      name: c.name,
      description: c.description,
      category: c.category,
      enabled: !disabledCommands.has(c.name),
    })),
    automations: ((automationRes.data ?? []) as {
      id: string
      name: string
      action_type: ActionType
      enabled: boolean
    }[]).map((a) => ({
      id: a.id,
      name: a.name,
      actionLabel: ACTION_BY_TYPE[a.action_type]?.label ?? a.action_type,
      enabled: a.enabled,
    })),
    moderationLogs: ((modLogRes.data ?? []) as {
      id: string
      action: string
      target_username: string | null
      target_display_name: string | null
      moderator_username: string | null
      reason: string | null
      created_at: string
    }[]).map((l) => ({
      id: l.id,
      action: l.action,
      target: l.target_display_name ?? l.target_username ?? null,
      moderator: l.moderator_username,
      reason: l.reason,
      createdAt: l.created_at,
    })),
    notifications: ((notifRes.data ?? []) as {
      id: string
      title: string
      body: string | null
      category: string
      link: string | null
      created_at: string
    }[]).map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      category: n.category,
      link: n.link,
      createdAt: n.created_at,
    })),
    generatedAt: new Date().toISOString(),
  }

  return NextResponse.json(index)
}
