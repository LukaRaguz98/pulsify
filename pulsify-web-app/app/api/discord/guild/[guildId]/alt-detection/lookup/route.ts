import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import {
  fetchGuildRoles,
  fetchGuildBan,
  fetchDiscordUser,
  snowflakeToDate,
  avatarUrl,
  defaultAvatarUrl,
  roleColor,
  type DiscordMember,
} from '@/lib/discord'
import {
  loadGuildRiskContext,
  scoreGuild,
  assessFromContext,
  correlateMember,
  loadAccountCase,
  memberAvatar,
  type AccountReport,
  type AccountStatus,
} from '@/lib/alt-detection-server'
import { normaliseName, type AltInvestigationEvent } from '@/lib/alt-detection'

// Account lookup for Alt Risk Detection (PULSIFY-59).
//
// One GET does the whole report: resolve the query to an account, score it,
// correlate it against the rest of the guild, and pull its case file. It's a
// read of live data every time — the score is never cached, because an account
// that was quiet yesterday and flagged today should read as flagged today.
//
// The one write it does is the audit trail: who looked up whom. Account risk is
// sensitive, so a lookup is a recorded action (debounced, see LOOKUP_DEBOUNCE_MS,
// so re-rendering the panel doesn't spam the history).

const LOOKUP_DEBOUNCE_MS = 5 * 60 * 1000

const ID_RE = /^\d{15,25}$/
const MENTION_RE = /^<@!?(\d{15,25})>$/

/** Resolve "@luka", "<@123…>", "123…" or a display name to a guild member. */
function resolveMember(query: string, members: DiscordMember[]): { id: string | null; member: DiscordMember | null } {
  const raw = query.trim()
  const mention = raw.match(MENTION_RE)
  const id = mention ? mention[1] : ID_RE.test(raw) ? raw : null
  if (id) return { id, member: members.find((m) => m.user.id === id) ?? null }

  // Name search: exact handle first, then display name, then a contains match.
  const needle = normaliseName(raw.replace(/^@/, ''))
  if (!needle) return { id: null, member: null }

  const names = (m: DiscordMember) =>
    [m.user.username, m.user.global_name ?? '', m.nick ?? ''].filter(Boolean).map(normaliseName)

  const exact = members.find((m) => names(m).includes(needle))
  if (exact) return { id: exact.user.id, member: exact }

  const partial = members.find((m) => names(m).some((n) => n.includes(needle)))
  return partial ? { id: partial.user.id, member: partial } : { id: null, member: null }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  // Account risk is a management surface — Manage Server / Administrator only.
  // authorizeGuildModerator (rather than requireGuildRole) because the lookup is
  // an audited action: we need the moderator's identity, not just their tier.
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 })

  const query = new URL(req.url).searchParams.get('q')?.trim() ?? ''
  if (!query) return NextResponse.json({ error: 'Search for a member, user ID or mention.' }, { status: 400 })

  const supabase = await createClient()
  const [ctx, roles] = await Promise.all([
    loadGuildRiskContext(supabase, guildId),
    fetchGuildRoles(guildId),
  ])

  const { id, member } = resolveMember(query, ctx.members)

  // A raw ID that isn't in the guild is still a valid lookup — a banned evader or
  // an account that already left is exactly what a moderator wants to check.
  const external = !member && id ? await fetchDiscordUser(id) : null
  if (!id || (!member && !external)) {
    return NextResponse.json(
      { error: `No account matched "${query}". Try a user ID, a mention, or an exact username.` },
      { status: 404 },
    )
  }

  const scored = scoreGuild(ctx)
  const scoredRow = scored.find((s) => s.userId === id)

  const username = member?.user.username ?? external?.username ?? 'Unknown'
  const displayName = member?.nick ?? member?.user.global_name ?? external?.global_name ?? username
  const hasAvatar = Boolean(member?.avatar || member?.user.avatar || external?.avatar)

  const risk = scoredRow?.risk ?? assessFromContext(ctx, id, member, hasAvatar)

  const [linked, { investigation, links }, ban, { data: timelineRows }] = await Promise.all([
    correlateMember(
      supabase,
      ctx,
      id,
      { username, displayName, joinedAt: member?.joined_at || null },
      scored,
    ),
    loadAccountCase(supabase, guildId, id),
    fetchGuildBan(guildId, id),
    supabase
      .from('alt_investigation_events')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const timedOut =
    member?.communication_disabled_until != null &&
    new Date(member.communication_disabled_until).getTime() > Date.now()
  const status: AccountStatus = ban ? 'banned' : !member ? 'left' : timedOut ? 'timed_out' : 'member'

  const avatar = member
    ? memberAvatar(guildId, member)
    : external?.avatar
      ? avatarUrl(id, external.avatar, '0', 64)
      : defaultAvatarUrl(id)

  const roleById = new Map(roles.map((r) => [r.id, r]))
  const memberRoles = (member?.roles ?? [])
    .map((roleId) => roleById.get(roleId))
    .filter((r) => r != null && r.name !== '@everyone')
    .sort((a, b) => b!.position - a!.position)
    .map((r) => ({ id: r!.id, name: r!.name, color: roleColor(r!.color) }))

  const report: AccountReport = {
    account: {
      userId: id,
      username,
      displayName,
      avatar,
      isMember: member != null,
      accountCreatedAt: snowflakeToDate(id)?.toISOString() ?? null,
      joinedAt: member?.joined_at || null,
      roles: memberRoles,
      status,
    },
    risk,
    activity: {
      messages: ctx.activity.get(id)?.messages ?? 0,
      voiceSeconds: ctx.activity.get(id)?.voiceSeconds ?? 0,
      lastActive: ctx.activity.get(id)?.lastActive ?? null,
    },
    linked,
    investigation,
    links,
  }

  // ── Audit trail ──
  // Record who pulled this report, unless the same moderator pulled it moments
  // ago (React re-renders and tab switches shouldn't each become a row).
  const { data: recent } = await supabase
    .from('alt_lookups')
    .select('created_at')
    .eq('guild_id', guildId)
    .eq('user_id', id)
    .eq('actor_id', auth.moderator.userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastAt = recent?.created_at ? new Date(recent.created_at).getTime() : 0
  if (Date.now() - lastAt > LOOKUP_DEBOUNCE_MS) {
    await supabase.from('alt_lookups').insert({
      guild_id: guildId,
      user_id: id,
      user_name: displayName,
      risk_score: risk.score,
      risk_level: risk.level,
      source: 'dashboard',
      actor_id: auth.moderator.userId,
      actor_name: auth.moderator.username,
    })
  }

  return NextResponse.json({
    report,
    timeline: (timelineRows ?? []) as AltInvestigationEvent[],
  })
}
