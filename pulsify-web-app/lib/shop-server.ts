import 'server-only'
import { getGlobalReputationBundle } from '@/lib/economy-server'
import { createClient } from '@/lib/supabase-server'
import { normaliseReward, type ShopReward, type RequirementContext } from '@/lib/shop'

// The exact server client type (avoids depending on @supabase/supabase-js types).
type DbClient = Awaited<ReturnType<typeof createClient>>

// Server-side reads for the Rewards Shop (PULSIFY-46). Shared by the shop-list
// and purchase routes so the catalogue and the gating context are computed the
// same way in both places.

/**
 * Load a guild's shop: its own server rewards plus the operator-managed global
 * catalogue. `includeInactive` is for the admin management view; the member
 * shop only ever sees active rewards.
 */
export async function loadGuildShop(
  supabase: DbClient,
  guildId: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<ShopReward[]> {
  let query = supabase
    .from('shop_rewards')
    .select('*')
    .or(`and(scope.eq.server,guild_id.eq.${guildId}),scope.eq.global`)
    .order('featured', { ascending: false })
    .order('sort', { ascending: true })
    .order('created_at', { ascending: false })
  if (!includeInactive) query = query.eq('active', true)
  const { data } = await query
  return (data ?? []).map((r) => normaliseReward(r as Record<string, unknown>))
}

/** A single reward by id (any scope). */
export async function loadReward(
  supabase: DbClient,
  rewardId: string,
): Promise<ShopReward | null> {
  const { data } = await supabase.from('shop_rewards').select('*').eq('id', rewardId).maybeSingle()
  return data ? normaliseReward(data as Record<string, unknown>) : null
}

/**
 * The buyer's gating context: global balance, global reputation score, this
 * guild's level and the milestone ids they've earned (used as "achievements").
 */
export async function getBuyerContext(
  supabase: DbClient,
  guildId: string,
  userId: string,
): Promise<RequirementContext> {
  const [walletRes, levelRes, achievementsRes, repBundle] = await Promise.all([
    supabase.from('economy_users').select('balance').eq('user_id', userId).maybeSingle(),
    supabase
      .from('member_levels')
      .select('level')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('member_milestones')
      .select('milestone_id')
      .eq('guild_id', guildId)
      .eq('user_id', userId),
    getGlobalReputationBundle(userId),
  ])

  return {
    balance: Number(walletRes.data?.balance ?? 0),
    level: Number(levelRes.data?.level ?? 0),
    reputation: repBundle.reputation.score,
    achievementIds: (achievementsRes.data ?? []).map((r) => String(r.milestone_id)),
  }
}

/**
 * How many non-refunded copies of each reward the user already owns — drives the
 * per-user-limit "owned / sold out for you" state in the shop.
 */
export async function getOwnedCounts(
  supabase: DbClient,
  userId: string,
  rewardIds: string[],
): Promise<Record<string, number>> {
  if (rewardIds.length === 0) return {}
  const { data } = await supabase
    .from('reward_purchases')
    .select('reward_id')
    .eq('user_id', userId)
    .neq('status', 'refunded')
    .in('reward_id', rewardIds)
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const id = String(row.reward_id)
    counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}
