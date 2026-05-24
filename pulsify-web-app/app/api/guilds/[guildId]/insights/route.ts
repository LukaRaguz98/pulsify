import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import {
  fetchGuild,
  fetchGuildChannels,
  fetchGuildRoles,
  fetchGuildMembers,
  snowflakeToDate,
} from '@/lib/discord'
import { permissionKeysFromBits, PERMISSION_BY_KEY } from '@/lib/discord-permissions'
import type { TimeseriesPoint } from '@/lib/analytics'
import {
  splitWindow,
  computeTrends,
  generateRecommendations,
  healthFromRecommendations,
  bestActivitySlot,
  isInsightWindow,
  type InsightSignals,
  type InsightsData,
  type InactiveChannel,
  type UnusedRole,
  type DangerousRole,
  type OnboardingStatusSignal,
  type TimeseriesTotals,
  type HeatmapCell,
} from '@/lib/insights'

const DAY_MS = 86_400_000
// The activity heatmap reads a fixed trailing window (independent of the trend
// selector) — a server's weekly rhythm needs more than a single week to emerge.
const HEATMAP_DAYS = 30
// Discord caps a single member page at 1000; the same ceiling the directory and
// search index use. When we hit it, per-role membership counts are a sample, so
// the "unused roles" signal is suppressed to avoid false positives.
const MEMBER_LIMIT = 1000
// Channels with no activity for at least this many days are flagged as inactive.
// Scaled with the window so a 30-day view doesn't nag about a 15-day-quiet
// channel that's busy month-to-month.
function inactiveThresholdDays(windowDays: number): number {
  return windowDays >= 30 ? 30 : 14
}
// Text-like channels where "last message" is a meaningful activity signal.
const TEXTY_CHANNEL_TYPES = new Set([0, 5, 15, 16])

/**
 * GET /api/guilds/[guildId]/insights?window=7|30
 *
 * Reduces Discord (channels, roles, members) + analytics (RPC timeseries,
 * summary, leaderboards) + feature config into a single InsightSignals object,
 * runs the pure recommendation engine over it, and returns the full insights
 * payload.
 *
 * Auth mirrors the analytics route (Supabase session only). We deliberately
 * avoid moderation-auth's `fetchUserGuilds` Discord call here — it hits the
 * heavily rate-limited `/users/@me/guilds` endpoint on every load, which made
 * Insights intermittently fail with "Couldn't verify your Discord access".
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId } = await params
  const windowParam = Number(new URL(req.url).searchParams.get('window'))
  const windowDays = isInsightWindow(windowParam) ? windowParam : 7

  const now = Date.now()
  // Two windows of daily buckets so we can compare "this period" vs "the period
  // before it" entirely from one timeseries query.
  const trendSince = new Date(now - windowDays * 2 * DAY_MS).toISOString()
  const windowSince = new Date(now - windowDays * DAY_MS).toISOString()
  const heatmapSince = new Date(now - HEATMAP_DAYS * DAY_MS).toISOString()

  const [
    guild,
    channels,
    roles,
    members,
    timeseriesRes,
    summaryRes,
    topChannelsRes,
    heatmapRes,
    settingsRow,
    aiModRow,
  ] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
    fetchGuildMembers(guildId, MEMBER_LIMIT),
    supabase.rpc('get_analytics_timeseries', {
      p_guild_id: guildId,
      p_since: trendSince,
      p_trunc: 'day',
    }),
    supabase.rpc('get_analytics_summary', { p_guild_id: guildId, p_since: windowSince }),
    supabase.rpc('get_top_channels', { p_guild_id: guildId, p_since: windowSince, p_limit: 8 }),
    supabase.rpc('get_activity_heatmap', { p_guild_id: guildId, p_since: heatmapSince }),
    supabase.from('guild_settings').select('settings').eq('guild_id', guildId).maybeSingle(),
    supabase.from('ai_moderation_settings').select('enabled').eq('guild_id', guildId).maybeSingle(),
  ])

  const rpcError = timeseriesRes.error ?? summaryRes.error ?? topChannelsRes.error
  if (rpcError) {
    return NextResponse.json({ error: `Insights query failed: ${rpcError.message}` }, { status: 500 })
  }

  // The heatmap RPC is best-effort: if it errors (e.g. the migration hasn't been
  // applied yet) we degrade gracefully to an empty heatmap rather than failing
  // the whole page.
  const heatmap = (heatmapRes.error ? [] : (heatmapRes.data ?? [])) as HeatmapCell[]

  const series = (timeseriesRes.data ?? []) as TimeseriesPoint[]
  const { current, previous } = splitWindow(series, windowDays, now)
  const trends = computeTrends(current, previous)

  const summary = summaryRes.data?.[0] as { active_users?: number } | undefined
  const activeUsers = Number(summary?.active_users ?? 0)
  const totalMembers = guild?.approximate_member_count ?? guild?.member_count ?? 0

  // ── Inactive channels (Discord last-message snowflake) ──────────────────────
  const threshold = inactiveThresholdDays(windowDays)
  const inactiveChannels: InactiveChannel[] = []
  for (const c of channels) {
    if (!TEXTY_CHANNEL_TYPES.has(c.type)) continue
    // Use the last message if there is one, else the channel's own creation
    // time — so a freshly-made empty channel isn't mislabelled "inactive".
    const lastActivity = c.last_message_id
      ? snowflakeToDate(c.last_message_id)
      : snowflakeToDate(c.id)
    if (!lastActivity) continue
    const daysInactive = Math.floor((now - lastActivity.getTime()) / DAY_MS)
    if (daysInactive >= threshold) {
      inactiveChannels.push({ id: c.id, name: c.name, daysInactive })
    }
  }
  inactiveChannels.sort((a, b) => b.daysInactive - a.daysInactive)

  // ── Role membership counts (from the sampled members) ───────────────────────
  const roleCounts = new Map<string, number>()
  for (const m of members) {
    for (const rid of m.roles) roleCounts.set(rid, (roleCounts.get(rid) ?? 0) + 1)
  }
  // If we hit the page cap there may be more members, so counts are a sample and
  // the unused-role signal can't be trusted.
  const unusedRolesReliable = members.length < MEMBER_LIMIT

  const manageableRoles = roles.filter((r) => r.id !== guildId && !r.managed)

  const unusedRoles: UnusedRole[] = unusedRolesReliable
    ? manageableRoles
        .filter((r) => (roleCounts.get(r.id) ?? 0) === 0)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.color }))
    : []

  // ── Dangerous roles (high-impact permissions) ───────────────────────────────
  const dangerousRoles: DangerousRole[] = []
  for (const r of manageableRoles) {
    const highDanger = permissionKeysFromBits(r.permissions)
      .map((k) => PERMISSION_BY_KEY.get(k))
      .filter((def) => def?.danger === 'high')
      .map((def) => def!.label)
    if (highDanger.length > 0) {
      dangerousRoles.push({ id: r.id, name: r.name, color: r.color, permissions: highDanger })
    }
  }
  dangerousRoles.sort((a, b) => b.permissions.length - a.permissions.length)

  // ── Feature config ───────────────────────────────────────────────────────────
  const settings = (settingsRow.data?.settings ?? {}) as Record<string, unknown>
  const welcome = settings.welcome as { enabled?: boolean } | undefined
  const welcomeConfigured = welcome?.enabled === true
  const pulseGuardEnabled = aiModRow.data?.enabled === true

  const onboardingState = settings.onboarding_state as { status?: string } | undefined
  const onboardingStatus: OnboardingStatusSignal =
    onboardingState?.status === 'completed'
      ? 'completed'
      : onboardingState?.status === 'in_progress'
        ? 'in_progress'
        : onboardingState?.status === 'skipped'
          ? 'skipped'
          : 'not_started'

  const signals: InsightSignals = {
    windowDays,
    current,
    previous,
    trends,
    activeUsers,
    totalMembers,
    inactiveChannels: inactiveChannels.slice(0, 8),
    unusedRoles: unusedRoles.slice(0, 8),
    unusedRolesReliable,
    dangerousRoles,
    pulseGuardEnabled,
    welcomeConfigured,
    onboardingStatus,
    peakActivitySlot: bestActivitySlot(heatmap),
  }

  const recommendations = generateRecommendations(signals)
  const health = healthFromRecommendations(recommendations)

  const totalsTouched = (t: TimeseriesTotals) =>
    t.messages + t.joins + t.leaves + t.commands + t.mod_actions + t.voice_seconds
  const hasActivity = totalsTouched(current) > 0 || totalsTouched(previous) > 0

  const data: InsightsData = {
    generatedAt: new Date().toISOString(),
    windowDays,
    hasActivity,
    health,
    overview: { current, previous, trends, activeUsers, totalMembers },
    series,
    topChannels: (topChannelsRes.data ?? []) as InsightsData['topChannels'],
    heatmap,
    heatmapDays: HEATMAP_DAYS,
    inactiveChannels: signals.inactiveChannels,
    unusedRoles: signals.unusedRoles,
    unusedRolesReliable,
    dangerousRoles: dangerousRoles.slice(0, 8),
    recommendations,
    // Text + announcement channels the recap can be posted to.
    postableChannels: channels
      .filter((c) => c.type === 0 || c.type === 5)
      .map((c) => ({ id: c.id, name: c.name }))
      .slice(0, 200),
  }

  return NextResponse.json(data)
}
