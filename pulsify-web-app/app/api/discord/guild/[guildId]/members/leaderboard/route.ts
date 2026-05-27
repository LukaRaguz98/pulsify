import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildMembers, fetchGuildRoles, avatarUrl, type DiscordMember } from '@/lib/discord'
import { memberReputation } from '@/lib/member-metrics'
import { normaliseLevelingSettings, levelForXp } from '@/lib/leveling'
import {
  EMPTY_ACTIVITY,
  EMPTY_INFRACTIONS,
  type MemberActivityStats,
  type MemberInfractions,
  type LeaderboardEntry,
  type LeaderboardKey,
  type LeaderboardResponse,
} from '@/lib/member-profile'

const TOP_N = 25

// Map the timeframe filter to a `p_since` bound (null = all time). Only the
// "Most active" board + the activity numbers are windowed — level / XP /
// reputation are always all-time.
function windowToSince(window: string): string | null {
  const days = window === '24h' ? 1 : window === '7d' ? 7 : window === '30d' ? 30 : null
  return days == null ? null : new Date(Date.now() - days * 86_400_000).toISOString()
}

// Level brackets for the distribution chart — 10 buckets of 5 levels each.
const BRACKETS: { label: string; min: number; max: number }[] = [
  { label: '0–4', min: 0, max: 4 },
  { label: '5–9', min: 5, max: 9 },
  { label: '10–14', min: 10, max: 14 },
  { label: '15–19', min: 15, max: 19 },
  { label: '20–24', min: 20, max: 24 },
  { label: '25–29', min: 25, max: 29 },
  { label: '30–34', min: 30, max: 34 },
  { label: '35–39', min: 35, max: 39 },
  { label: '40–44', min: 40, max: 44 },
  { label: '45+', min: 45, max: Infinity },
]

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
  const url = new URL(req.url)
  const window = url.searchParams.get('window') ?? '30d'
  const since = windowToSince(window)

  const [members, roles, levelsRes, infrRes, settingsRes, statsAllRes, statsWindowRes] =
    await Promise.all([
      fetchGuildMembers(guildId, 1000),
      fetchGuildRoles(guildId),
      supabase.from('member_levels').select('user_id, xp, level').eq('guild_id', guildId),
      supabase.rpc('get_guild_members_infractions', { p_guild_id: guildId }),
      supabase.from('leveling_settings').select('enabled, settings').eq('guild_id', guildId).maybeSingle(),
      // All-time activity drives reputation; the windowed pass drives "Most active".
      supabase.rpc('get_guild_members_stats', { p_guild_id: guildId, p_since: null }),
      since
        ? supabase.rpc('get_guild_members_stats', { p_guild_id: guildId, p_since: since })
        : Promise.resolve({ data: null as unknown }),
    ])

  const curve = normaliseLevelingSettings(settingsRes.data ?? null).curve

  const levelsByUser = new Map<string, { xp: number; level: number }>()
  for (const r of (levelsRes.data ?? []) as Record<string, unknown>[]) {
    levelsByUser.set(String(r.user_id), { xp: Number(r.xp ?? 0), level: Number(r.level ?? 0) })
  }

  const statsAll = new Map<string, MemberActivityStats>()
  for (const r of (statsAllRes.data ?? []) as Record<string, unknown>[]) {
    statsAll.set(String(r.user_id), {
      message_count: Number(r.message_count ?? 0),
      command_count: Number(r.command_count ?? 0),
      voice_seconds: Number(r.voice_seconds ?? 0),
      last_active: (r.last_active as string | null) ?? null,
    })
  }

  // When the window is "all", the windowed numbers are the all-time numbers.
  const windowSource = (since ? (statsWindowRes.data as Record<string, unknown>[] | null) : (statsAllRes.data as Record<string, unknown>[] | null)) ?? []
  const statsWindow = new Map<string, MemberActivityStats>()
  for (const r of windowSource) {
    statsWindow.set(String(r.user_id), {
      message_count: Number(r.message_count ?? 0),
      command_count: Number(r.command_count ?? 0),
      voice_seconds: Number(r.voice_seconds ?? 0),
      last_active: (r.last_active as string | null) ?? null,
    })
  }

  const infrByUser = new Map<string, MemberInfractions>()
  for (const r of (infrRes.data ?? []) as Record<string, unknown>[]) {
    infrByUser.set(String(r.user_id), {
      warnings: Number(r.warnings ?? 0),
      active_warnings: Number(r.active_warnings ?? 0),
      timeouts: Number(r.timeouts ?? 0),
      kicks: Number(r.kicks ?? 0),
      bans: Number(r.bans ?? 0),
      total_infractions: Number(r.total_infractions ?? 0),
      last_infraction_at: (r.last_infraction_at as string | null) ?? null,
    })
  }

  // Build one row per human member (bots are excluded from community boards).
  type Row = { entry: LeaderboardEntry; member: DiscordMember }
  const rows: Row[] = []
  for (const m of members) {
    if (m.user.bot) continue
    const lvl = levelsByUser.get(m.user.id) ?? { xp: 0, level: 0 }
    const activityAll = statsAll.get(m.user.id) ?? EMPTY_ACTIVITY
    const infractions = infrByUser.get(m.user.id) ?? EMPTY_INFRACTIONS
    const activityWindow = statsWindow.get(m.user.id) ?? EMPTY_ACTIVITY
    const reputation = memberReputation(m, roles, activityAll, infractions)
    rows.push({
      member: m,
      entry: {
        userId: m.user.id,
        name: m.nick ?? m.user.global_name ?? m.user.username,
        avatar: avatarUrl(m.user.id, m.user.avatar),
        // Trust the stored level when present; otherwise derive from xp.
        level: lvl.level || levelForXp(lvl.xp, curve),
        xp: lvl.xp,
        reputation: reputation.score,
        messages: activityWindow.message_count,
        voiceSeconds: activityWindow.voice_seconds,
      },
    })
  }

  const top = (key: LeaderboardKey, cmp: (a: LeaderboardEntry, b: LeaderboardEntry) => number) =>
    rows.map((r) => r.entry).sort(cmp).slice(0, TOP_N)

  const boards: Record<LeaderboardKey, LeaderboardEntry[]> = {
    level: top('level', (a, b) => b.level - a.level || b.xp - a.xp).filter((e) => e.xp > 0),
    xp: top('xp', (a, b) => b.xp - a.xp).filter((e) => e.xp > 0),
    reputation: top('reputation', (a, b) => b.reputation - a.reputation),
    active: top('active', (a, b) => b.messages - a.messages || b.voiceSeconds - a.voiceSeconds).filter((e) => e.messages > 0),
  }

  // Distribution + totals from every tracked member (those with a level row).
  const distribution = BRACKETS.map((b) => ({ label: b.label, count: 0 }))
  let totalXp = 0
  let topLevel = 0
  let tracked = 0
  for (const { xp, level } of levelsByUser.values()) {
    tracked++
    totalXp += xp
    if (level > topLevel) topLevel = level
    const bucket = BRACKETS.findIndex((b) => level >= b.min && level <= b.max)
    if (bucket >= 0) distribution[bucket].count++
  }
  const avgLevel = tracked > 0
    ? Math.round(([...levelsByUser.values()].reduce((s, v) => s + v.level, 0) / tracked) * 10) / 10
    : 0

  const response: LeaderboardResponse = {
    boards,
    distribution,
    totals: { tracked, totalXp, avgLevel, topLevel },
    window,
    curve,
  }
  return NextResponse.json(response)
}
