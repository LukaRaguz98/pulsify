import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { normaliseEconomyUser } from '@/lib/economy'
import { normalisePurchase, ownedCosmetics } from '@/lib/shop'

/**
 * GET /api/guilds/[guildId]/economy/profile?user=<discordId>
 *
 * The global coin side of a member's Pulse Profile: their wallet (balance +
 * lifetime stats), global balance rank, per-server levels across every Pulse
 * server they're active in, and total achievements (milestones earned
 * anywhere). Reputation is NOT here — it's the computed trust score the member
 * profile already has. Guild-scoped purely for auth-shape consistency; the data
 * itself is global.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params // guild-scoped for auth-shape; payload is global
  // Any member may read it — this powers leaderboard click-through to ANY
  // profile, global or local. Balance, rank, reputation, achievements and
  // cosmetics are already public on the leaderboards, so they're returned for
  // everyone. The one privacy-sensitive piece — WHICH other Pulse servers the
  // user belongs to — is revealed only to the user themselves (see redaction
  // below); for everyone else the per-server breakdown is trimmed to this guild.
  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const userId = new URL(req.url).searchParams.get('user')?.trim()
  if (!userId || !/^\d{5,25}$/.test(userId)) {
    return NextResponse.json({ error: 'A valid user id is required.' }, { status: 400 })
  }
  const isSelf = userId === auth.access.userId

  const [walletRes, levelsRes, milestonesRes, cosmeticsRes] = await Promise.all([
    supabase.from('economy_users').select('*').eq('user_id', userId).maybeSingle(),
    supabase
      .from('member_levels')
      .select('guild_id, xp, level')
      .eq('user_id', userId)
      .order('xp', { ascending: false })
      .limit(50),
    supabase
      .from('member_milestones')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    // Owned badge/cosmetic rewards (global — the member's Pulse identity travels
    // with them, so no guild filter). Newest first so dedupe keeps the latest.
    supabase
      .from('reward_purchases')
      .select('id, reward_snapshot, status, enabled, created_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const wallet = walletRes.data
    ? normaliseEconomyUser(walletRes.data as Record<string, unknown>)
    : null

  // Global balance rank only exists once the member has a wallet.
  let balanceRank: number | null = null
  if (wallet) {
    const { count: richer } = await supabase
      .from('economy_users')
      .select('user_id', { count: 'exact', head: true })
      .gt('balance', wallet.balance)
    balanceRank = (richer ?? 0) + 1
  }

  // Resolve server names for the per-server level list. Privacy: a user's
  // membership across OTHER Pulse servers is only theirs to see — for anyone
  // else we keep the accurate total count but trim the breakdown to this guild.
  const allLevels = levelsRes.data ?? []
  const serverCount = allLevels.length
  const levels = isSelf ? allLevels : allLevels.filter((l) => l.guild_id === guildId)
  const serversRedacted = !isSelf && serverCount > levels.length
  let nameById = new Map<string, string>()
  if (levels.length > 0) {
    const { data: guilds } = await supabase
      .from('synced_guilds')
      .select('guild_id, name')
      .in('guild_id', levels.map((l) => l.guild_id))
    nameById = new Map((guilds ?? []).map((g) => [g.guild_id, g.name as string]))
  }

  const cosmetics = ownedCosmetics(
    (cosmeticsRes.data ?? []).map((r) => normalisePurchase(r as Record<string, unknown>)),
  )

  return NextResponse.json({
    wallet,
    ranks: { balance: balanceRank },
    servers: levels.map((l) => ({
      guild_id: l.guild_id,
      guild_name: nameById.get(l.guild_id) ?? null,
      level: Number(l.level ?? 0),
      xp: Number(l.xp ?? 0),
    })),
    // True total across every Pulse server (the `servers` list above may be
    // redacted for non-self viewers); `serversRedacted` flags that trim.
    serverCount,
    serversRedacted,
    achievements: milestonesRes.count ?? 0,
    cosmetics,
  })
}
