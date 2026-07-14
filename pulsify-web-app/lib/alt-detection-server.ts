import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchGuildMembers,
  snowflakeToDate,
  avatarUrl,
  guildMemberAvatarUrl,
  defaultAvatarUrl,
  type DiscordMember,
} from '@/lib/discord'
import { computeReputation, daysSince } from '@/lib/reputation'
import {
  computeAltRisk,
  correlateAccounts,
  orderPair,
  type AltInvestigation,
  type AltLink,
  type AltRiskAssessment,
  type CorrelationCandidate,
  type CorrelationSubject,
  type LinkedAccount,
} from '@/lib/alt-detection'

// Alt Risk Detection — server-side data loading (PULSIFY-59).
//
// The risk score is COMPUTED, never stored: every lookup and every dashboard
// render re-derives it from the tables Pulse already fills. That's the whole
// point — a stored score would silently rot as the member's behaviour changed.
//
// The cost of "recompute everything" is round trips, so this module loads the
// guild ONCE into a context of id-keyed maps (loadGuildRiskContext) and then
// scores members out of it in memory. The dashboard scores every member from
// that context; the lookup route scores one member and correlates them against
// the rest, adding only the two extras a single subject needs (hourly
// histograms, transfer counts).
//
// Everything here is a read. Writes (investigations, notes, links) live in the
// route's server actions.

// ── Context ───────────────────────────────────────────────────────────────────

type Activity = { messages: number; voiceSeconds: number; lastActive: string | null }
type Infractions = { warnings: number; timeouts: number; kicks: number; bans: number }

/** Everything needed to score any member of a guild, loaded in one pass. */
export type GuildRiskContext = {
  guildId: string
  now: Date
  /** Live Discord members (bots excluded — a bot is never an alt). */
  members: DiscordMember[]
  onboardingEnabled: boolean
  activity: Map<string, Activity>
  infractions: Map<string, Infractions>
  reputation: Map<string, number>
  economy: Map<string, { balance: number; lifetime: number }>
  giveawayEntries: Map<string, number>
  applications: Map<string, number>
  onboarding: Map<string, { completed: boolean; verified: boolean }>
  guardFlags: Map<string, number>
  securityFlags: Map<string, number>
  /** Manual links keyed by user id → the ids they're linked to. */
  linksByUser: Map<string, string[]>
  /** Investigations that closed as "confirmed alt", by user id. */
  confirmedAlts: Set<string>
}

function tally<T>(rows: T[], key: (row: T) => string | null | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    const id = key(row)
    if (!id) continue
    out.set(id, (out.get(id) ?? 0) + 1)
  }
  return out
}

/**
 * Load every signal source for a guild in one parallel pass.
 *
 * `memberLimit` bounds the Discord member fetch (the same 1000-member ceiling
 * the member directory uses). Guilds bigger than that are scored on the members
 * Discord returns; the lookup path resolves any user by id regardless.
 */
export async function loadGuildRiskContext(
  supabase: SupabaseClient,
  guildId: string,
  memberLimit = 1000,
): Promise<GuildRiskContext> {
  const [
    allMembers,
    activityRes,
    infractionsRes,
    onboardingSettingsRes,
    onboardingRes,
    giveawayRes,
    applicationsRes,
    guardRes,
    securityRes,
    linksRes,
    confirmedRes,
  ] = await Promise.all([
    fetchGuildMembers(guildId, memberLimit),
    supabase.rpc('get_guild_members_stats', { p_guild_id: guildId, p_since: null }),
    supabase.rpc('get_guild_members_infractions', { p_guild_id: guildId }),
    supabase.from('guild_settings').select('settings').eq('guild_id', guildId).maybeSingle(),
    supabase.from('onboarding_member_progress').select('user_id, status, verified').eq('guild_id', guildId),
    supabase.from('giveaway_entries').select('user_id').eq('guild_id', guildId).limit(5000),
    supabase.from('ticket_applications').select('applicant_id').eq('guild_id', guildId).limit(2000),
    supabase.from('ai_moderation_events').select('author_id').eq('guild_id', guildId).limit(5000),
    supabase.from('security_events').select('actor_id').eq('guild_id', guildId).limit(2000),
    supabase.from('alt_account_links').select('*').eq('guild_id', guildId),
    supabase
      .from('alt_investigations')
      .select('user_id')
      .eq('guild_id', guildId)
      .in('status', ['confirmed', 'banned']),
  ])

  // Bots have no risk profile — exclude them everywhere so they never pollute
  // the dashboard's "highest risk" list or a lookup's linked candidates.
  const members = allMembers.filter((m) => !m.user.bot)
  const memberIds = members.map((m) => m.user.id)

  // Global reputation + global economy: one batched call each, keyed by user.
  const [repRes, economyRes] = await Promise.all([
    memberIds.length
      ? supabase.rpc('get_global_members_reputation', { p_user_ids: memberIds })
      : Promise.resolve({ data: [] }),
    memberIds.length
      ? supabase
          .from('economy_users')
          .select('user_id, balance, lifetime_earned, lifetime_spent')
          .in('user_id', memberIds)
      : Promise.resolve({ data: [] }),
  ])

  const activity = new Map<string, Activity>()
  for (const r of (activityRes.data ?? []) as Record<string, unknown>[]) {
    activity.set(String(r.user_id), {
      messages: Number(r.message_count ?? 0),
      voiceSeconds: Number(r.voice_seconds ?? 0),
      lastActive: (r.last_active as string | null) ?? null,
    })
  }

  const infractions = new Map<string, Infractions>()
  for (const r of (infractionsRes.data ?? []) as Record<string, unknown>[]) {
    infractions.set(String(r.user_id), {
      warnings: Number(r.warnings ?? 0),
      timeouts: Number(r.timeouts ?? 0),
      kicks: Number(r.kicks ?? 0),
      bans: Number(r.bans ?? 0),
    })
  }

  // Same maths as the member directory: account age from the snowflake, the rest
  // from the cross-guild aggregate, so the reputation shown here matches the one
  // on the member's profile exactly.
  const reputation = new Map<string, number>()
  const repRows = (repRes.data ?? []) as Record<string, unknown>[]
  const repById = new Map(repRows.map((r) => [String(r.user_id), r]))
  for (const id of memberIds) {
    const g = repById.get(id)
    reputation.set(
      id,
      computeReputation({
        accountAgeDays: daysSince(snowflakeToDate(id)?.toISOString() ?? null),
        tenureDays: daysSince((g?.first_seen as string | null) ?? null),
        messages: Number(g?.message_count ?? 0),
        voiceSeconds: Number(g?.voice_seconds ?? 0),
        commands: Number(g?.command_count ?? 0),
        activeChannels: Number(g?.active_channels ?? 0),
        assignableRoles: 0,
        warnings: Number(g?.warnings ?? 0),
        timeouts: Number(g?.timeouts ?? 0),
        kicks: Number(g?.kicks ?? 0),
        bans: Number(g?.bans ?? 0),
      }).score,
    )
  }

  // economy_users keeps lifetime counters precisely so callers don't have to
  // scan the ledger — a wallet that has never moved is exactly what the
  // "no economy footprint" signal means.
  const economy = new Map<string, { balance: number; lifetime: number }>()
  for (const r of ((economyRes.data ?? []) as Record<string, unknown>[])) {
    economy.set(String(r.user_id), {
      balance: Number(r.balance ?? 0),
      lifetime: Number(r.lifetime_earned ?? 0) + Number(r.lifetime_spent ?? 0),
    })
  }

  const onboarding = new Map<string, { completed: boolean; verified: boolean }>()
  for (const r of ((onboardingRes.data ?? []) as Record<string, unknown>[])) {
    onboarding.set(String(r.user_id), {
      completed: r.status === 'completed',
      verified: Boolean(r.verified),
    })
  }

  // The onboarding signals only make sense when the guild runs onboarding —
  // otherwise every member would be penalised for skipping a step that doesn't
  // exist. `settings.member_onboarding.enabled` is where that lives.
  const guildSettings = (onboardingSettingsRes.data?.settings ?? {}) as Record<string, unknown>
  const memberOnboarding = (guildSettings.member_onboarding ?? {}) as Record<string, unknown>
  const onboardingEnabled = Boolean(memberOnboarding.enabled)

  const links = (linksRes.data ?? []) as AltLink[]
  const linksByUser = new Map<string, string[]>()
  for (const link of links) {
    linksByUser.set(link.user_id, [...(linksByUser.get(link.user_id) ?? []), link.linked_user_id])
    linksByUser.set(link.linked_user_id, [...(linksByUser.get(link.linked_user_id) ?? []), link.user_id])
  }

  return {
    guildId,
    now: new Date(),
    members,
    onboardingEnabled,
    activity,
    infractions,
    reputation,
    economy,
    giveawayEntries: tally((giveawayRes.data ?? []) as Record<string, unknown>[], (r) => String(r.user_id)),
    applications: tally((applicationsRes.data ?? []) as Record<string, unknown>[], (r) => String(r.applicant_id)),
    onboarding,
    guardFlags: tally((guardRes.data ?? []) as Record<string, unknown>[], (r) =>
      r.author_id ? String(r.author_id) : null,
    ),
    securityFlags: tally((securityRes.data ?? []) as Record<string, unknown>[], (r) =>
      r.actor_id ? String(r.actor_id) : null,
    ),
    linksByUser,
    confirmedAlts: new Set(
      ((confirmedRes.data ?? []) as Record<string, unknown>[]).map((r) => String(r.user_id)),
    ),
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Score one account out of a loaded context. `member` may be null for a user who
 * isn't in the guild (a banned evader, say) — the join-dependent signals then
 * simply don't fire.
 */
export function assessFromContext(
  ctx: GuildRiskContext,
  userId: string,
  member: DiscordMember | null,
  hasAvatar: boolean,
): AltRiskAssessment {
  const act = ctx.activity.get(userId)
  const infr = ctx.infractions.get(userId)
  const eco = ctx.economy.get(userId)
  const onb = ctx.onboarding.get(userId)

  return computeAltRisk({
    accountCreatedAt: snowflakeToDate(userId)?.toISOString() ?? null,
    joinedAt: member?.joined_at || null,
    hasAvatar,
    messages: act?.messages ?? 0,
    voiceSeconds: act?.voiceSeconds ?? 0,
    warnings: infr?.warnings ?? 0,
    timeouts: infr?.timeouts ?? 0,
    kicks: infr?.kicks ?? 0,
    bans: infr?.bans ?? 0,
    reputation: ctx.reputation.get(userId) ?? 0,
    coinBalance: eco?.balance ?? 0,
    economyLifetime: eco?.lifetime ?? 0,
    giveawayEntries: ctx.giveawayEntries.get(userId) ?? 0,
    applications: ctx.applications.get(userId) ?? 0,
    onboardingEnabled: ctx.onboardingEnabled,
    onboardingCompleted: onb?.completed ?? false,
    onboardingVerified: onb?.verified ?? false,
    guardFlags: ctx.guardFlags.get(userId) ?? 0,
    securityFlags: ctx.securityFlags.get(userId) ?? 0,
    priorConfirmedAlt: ctx.confirmedAlts.has(userId),
    manualLinks: ctx.linksByUser.get(userId)?.length ?? 0,
    now: ctx.now,
  })
}

/** A member decorated with their score — the dashboard's list row. */
export type ScoredMember = {
  userId: string
  username: string
  displayName: string
  avatar: string
  joinedAt: string | null
  accountCreatedAt: string | null
  risk: AltRiskAssessment
}

/** Discord CDN URL for a member's avatar (guild override → global → default). */
export function memberAvatar(guildId: string, member: DiscordMember): string {
  if (member.avatar) return guildMemberAvatarUrl(guildId, member.user.id, member.avatar, 64)
  if (member.user.avatar) return avatarUrl(member.user.id, member.user.avatar, '0', 64)
  return defaultAvatarUrl(member.user.id)
}

/** Score every member in the context, highest risk first. */
export function scoreGuild(ctx: GuildRiskContext): ScoredMember[] {
  return ctx.members
    .map((m) => ({
      userId: m.user.id,
      username: m.user.username,
      displayName: m.nick ?? m.user.global_name ?? m.user.username,
      avatar: memberAvatar(ctx.guildId, m),
      joinedAt: m.joined_at || null,
      accountCreatedAt: snowflakeToDate(m.user.id)?.toISOString() ?? null,
      // A guild-level avatar override still counts as "has an avatar".
      risk: assessFromContext(ctx, m.user.id, m, Boolean(m.avatar || m.user.avatar)),
    }))
    .sort((a, b) => b.risk.score - a.risk.score)
}

// ── Correlation ───────────────────────────────────────────────────────────────

/**
 * Correlate one member against the rest of the guild.
 *
 * Two of the six indicators need data the context doesn't carry (they're
 * subject-specific, so loading them for every member would be wasteful):
 *
 *   • moderation overlap — moderation_logs rows for the subject and the
 *     candidates, matched on moderator + reason, plus a scan for records that
 *     literally name the subject (the "ban evasion — alt of @x" case).
 *   • coin transfers between the subject and each candidate.
 *   • hourly activity histograms, fetched only for the shortlist.
 *
 * Everything is bounded: the shortlist is scored cheaply first, and only the top
 * candidates pay for a histogram.
 */
export async function correlateMember(
  supabase: SupabaseClient,
  ctx: GuildRiskContext,
  subjectId: string,
  subject: { username: string; displayName: string | null; joinedAt: string | null },
  scored: ScoredMember[],
  limit = 8,
): Promise<LinkedAccount[]> {
  const others = scored.filter((s) => s.userId !== subjectId)
  if (others.length === 0) return []

  const [modLogsRes, transfersRes, manualLinksRes] = await Promise.all([
    supabase
      .from('moderation_logs')
      .select('target_user_id, moderator_id, moderator_username, reason')
      .eq('guild_id', ctx.guildId)
      .limit(2000),
    // Transfers are global (the economy is), so this isn't guild-filtered: an
    // alt funnelling coins to its main from another server is the same evidence.
    supabase
      .from('economy_transactions')
      .select('user_id, counterparty_id')
      .or(`user_id.eq.${subjectId},counterparty_id.eq.${subjectId}`)
      .not('counterparty_id', 'is', null)
      .limit(1000),
    supabase
      .from('alt_account_links')
      .select('*')
      .eq('guild_id', ctx.guildId)
      .or(`user_id.eq.${subjectId},linked_user_id.eq.${subjectId}`),
  ])

  // ── Moderation overlap ──
  type ModRow = { target_user_id: string | null; moderator_id: string | null; moderator_username: string | null; reason: string | null }
  const modLogs = (modLogsRes.data ?? []) as ModRow[]
  const subjectCases = modLogs.filter((r) => r.target_user_id === subjectId)
  const subjectCaseKeys = new Set(
    subjectCases
      .filter((r) => r.moderator_id && r.reason)
      .map((r) => `${r.moderator_id}:${normaliseReason(r.reason)}`),
  )
  const subjectNames = [subject.username, subject.displayName ?? '', subjectId]
    .filter(Boolean)
    .map((s) => s.toLowerCase())

  const sharedModeration = new Map<
    string,
    { moderator: string | null; reason: string | null; namesSubject: boolean }
  >()
  for (const row of modLogs) {
    const target = row.target_user_id
    if (!target || target === subjectId) continue
    // A record on the candidate that literally names the subject — the strongest
    // moderation signal there is ("alt of @x", "ban evasion: <id>").
    const reason = row.reason?.toLowerCase() ?? ''
    if (reason && subjectNames.some((n) => n.length >= 3 && reason.includes(n))) {
      sharedModeration.set(target, { moderator: row.moderator_username, reason: row.reason, namesSubject: true })
      continue
    }
    // Otherwise: the same moderator actioned both accounts for the same reason.
    if (sharedModeration.get(target)?.namesSubject) continue
    if (!row.moderator_id || !row.reason) continue
    if (subjectCaseKeys.has(`${row.moderator_id}:${normaliseReason(row.reason)}`)) {
      sharedModeration.set(target, {
        moderator: row.moderator_username,
        reason: row.reason,
        namesSubject: false,
      })
    }
  }

  // ── Coin transfers with the subject ──
  const sharedEconomy = new Map<string, number>()
  for (const row of ((transfersRes.data ?? []) as { user_id: string; counterparty_id: string | null }[])) {
    const other = row.user_id === subjectId ? row.counterparty_id : row.user_id
    if (!other || other === subjectId) continue
    sharedEconomy.set(other, (sharedEconomy.get(other) ?? 0) + 1)
  }

  // ── Existing moderator-asserted links ──
  const manualLinks = new Map<string, { confidence: number; note: string | null }>()
  for (const link of ((manualLinksRes.data ?? []) as AltLink[])) {
    const other = link.user_id === subjectId ? link.linked_user_id : link.user_id
    manualLinks.set(other, { confidence: link.confidence, note: link.note })
  }

  const subjectPayload: CorrelationSubject = {
    userId: subjectId,
    username: subject.username,
    displayName: subject.displayName,
    accountCreatedAt: snowflakeToDate(subjectId)?.toISOString() ?? null,
    joinedAt: subject.joinedAt,
    hourly: [],
    messages: ctx.activity.get(subjectId)?.messages ?? 0,
  }

  const buildCandidate = (s: ScoredMember, hourly: number[]): CorrelationCandidate => ({
    userId: s.userId,
    username: s.username,
    displayName: s.displayName,
    avatar: s.avatar,
    accountCreatedAt: s.accountCreatedAt,
    joinedAt: s.joinedAt,
    hourly,
    messages: ctx.activity.get(s.userId)?.messages ?? 0,
    risk: { score: s.risk.score, level: s.risk.level },
    sharedModeration: sharedModeration.get(s.userId) ?? null,
    sharedEconomy: sharedEconomy.get(s.userId) ?? 0,
    manualLink: manualLinks.get(s.userId) ?? null,
  })

  // Pass 1 — everything except the activity-pattern indicator (no histograms
  // yet). This is pure in-memory work over the members we already have.
  const shortlist = correlateAccounts(
    subjectPayload,
    others.map((s) => buildCandidate(s, [])),
    Math.max(limit * 2, 12),
  )
  // Anyone with a manual link is always in the final list, even if the pass-1
  // scoring wouldn't have surfaced them.
  const shortlistIds = new Set(shortlist.map((l) => l.userId))
  for (const id of manualLinks.keys()) shortlistIds.add(id)
  if (shortlistIds.size === 0) return []

  // Pass 2 — fetch histograms for the subject + the shortlist only, then re-score
  // so "similar activity patterns" can contribute.
  const ids = [subjectId, ...shortlistIds]
  const { data: matrix } = await supabase.rpc('get_guild_hourly_matrix', {
    p_guild_id: ctx.guildId,
    p_user_ids: ids,
    p_since: null,
  })
  const hourlyByUser = new Map<string, number[]>()
  for (const row of ((matrix ?? []) as Record<string, unknown>[])) {
    const id = String(row.user_id)
    const hours = hourlyByUser.get(id) ?? new Array(24).fill(0)
    hours[Number(row.hour ?? 0) % 24] = Number(row.message_count ?? 0)
    hourlyByUser.set(id, hours)
  }

  const linked = correlateAccounts(
    { ...subjectPayload, hourly: hourlyByUser.get(subjectId) ?? [] },
    others
      .filter((s) => shortlistIds.has(s.userId))
      .map((s) => buildCandidate(s, hourlyByUser.get(s.userId) ?? [])),
    limit,
  )

  // A moderator-asserted link outlives the membership that produced it: the
  // linked account may have since left or been banned, which is exactly when a
  // moderator most wants to see it. Those accounts aren't in `scored` (it only
  // covers current members), so add them back from the link rows themselves.
  const present = new Set(linked.map((l) => l.userId))
  for (const [id, link] of manualLinks) {
    if (present.has(id)) continue
    const row = ((manualLinksRes.data ?? []) as AltLink[]).find(
      (l) => l.user_id === id || l.linked_user_id === id,
    )
    const name = (row?.user_id === id ? row?.user_name : row?.linked_user_name) ?? id
    // Scored with what we know about an ex-member: account age from the
    // snowflake, plus any moderation / guard / investigation history they left
    // behind. Join-dependent signals simply don't fire.
    const risk = assessFromContext(ctx, id, null, true)
    linked.push({
      userId: id,
      username: name,
      displayName: name,
      avatar: defaultAvatarUrl(id),
      confidence: link.confidence,
      indicators: [
        {
          id: 'manual',
          label: 'Linked by a moderator',
          detail: link.note?.trim() || 'A moderator marked these accounts as related.',
          weight: 1,
        },
      ],
      risk: { score: risk.score, level: risk.level },
      manual: true,
      note: link.note,
    })
  }

  return linked.sort((a, b) => b.confidence - a.confidence || b.risk.score - a.risk.score)
}

/** Lowercase + collapse whitespace, so "Ban evasion " and "ban  evasion" match. */
function normaliseReason(reason: string | null): string {
  return (reason ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// ── Report ────────────────────────────────────────────────────────────────────

/** Everything the lookup view renders for one account. */
export type AccountReport = {
  account: {
    userId: string
    username: string
    displayName: string
    avatar: string
    /** False when the user isn't in the guild (left, or never joined). */
    isMember: boolean
    accountCreatedAt: string | null
    joinedAt: string | null
    roles: { id: string; name: string; color: string }[]
    /** Live status: 'member' | 'left' | 'banned' | 'timed_out'. */
    status: AccountStatus
  }
  risk: AltRiskAssessment
  activity: { messages: number; voiceSeconds: number; lastActive: string | null }
  linked: LinkedAccount[]
  investigation: AltInvestigation | null
  links: AltLink[]
}

export type AccountStatus = 'member' | 'left' | 'banned' | 'timed_out'

/** Fetch the manual links + investigation attached to one account. */
export async function loadAccountCase(
  supabase: SupabaseClient,
  guildId: string,
  userId: string,
): Promise<{ investigation: AltInvestigation | null; links: AltLink[] }> {
  const [invRes, linksRes] = await Promise.all([
    supabase
      .from('alt_investigations')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('alt_account_links')
      .select('*')
      .eq('guild_id', guildId)
      .or(`user_id.eq.${userId},linked_user_id.eq.${userId}`)
      .order('created_at', { ascending: false }),
  ])
  return {
    investigation: (invRes.data as AltInvestigation | null) ?? null,
    links: (linksRes.data ?? []) as AltLink[],
  }
}

/** The pair, ordered the way alt_account_links stores it. Re-exported for actions. */
export { orderPair }
