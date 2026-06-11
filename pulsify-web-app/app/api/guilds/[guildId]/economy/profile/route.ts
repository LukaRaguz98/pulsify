import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { normaliseEconomyUser } from '@/lib/economy'

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
  // Members may read it (it powers their own Pulse Profile); admins use it on
  // the member detail pages. Members may only query THEMSELVES — the global
  // wallet of an arbitrary member is admin-surface data.
  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const userId = new URL(req.url).searchParams.get('user')?.trim()
  if (!userId || !/^\d{5,25}$/.test(userId)) {
    return NextResponse.json({ error: 'A valid user id is required.' }, { status: 400 })
  }
  if (auth.access.role !== 'admin' && userId !== auth.access.userId) {
    return NextResponse.json({ error: 'You can only view your own Pulse profile.' }, { status: 403 })
  }

  const [walletRes, levelsRes, milestonesRes] = await Promise.all([
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

  // Resolve server names for the per-server level list.
  const levels = levelsRes.data ?? []
  let nameById = new Map<string, string>()
  if (levels.length > 0) {
    const { data: guilds } = await supabase
      .from('synced_guilds')
      .select('guild_id, name')
      .in('guild_id', levels.map((l) => l.guild_id))
    nameById = new Map((guilds ?? []).map((g) => [g.guild_id, g.name as string]))
  }

  return NextResponse.json({
    wallet,
    ranks: { balance: balanceRank },
    servers: levels.map((l) => ({
      guild_id: l.guild_id,
      guild_name: nameById.get(l.guild_id) ?? null,
      level: Number(l.level ?? 0),
      xp: Number(l.xp ?? 0),
    })),
    achievements: milestonesRes.count ?? 0,
  })
}
