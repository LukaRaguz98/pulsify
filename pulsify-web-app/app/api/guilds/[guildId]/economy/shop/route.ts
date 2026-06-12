import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { requireOperator } from '@/lib/operator'
import { getCurrentDiscordUser } from '@/lib/workspace-auth'
import { sanitizeRewardInput, REWARD_LIMITS, type RewardScope } from '@/lib/shop'
import { loadGuildShop, getBuyerContext, getOwnedCounts } from '@/lib/shop-server'

/**
 * GET /api/guilds/[guildId]/economy/shop
 *   — The shop catalogue (this guild's server rewards + the global catalogue)
 *     plus the viewer's gating context (balance, reputation, level,
 *     achievements) and how many of each reward they already own. Any member
 *     may read it. `?manage=1` returns inactive rewards too (admin only) for the
 *     reward-management view.
 *
 * POST — Create a reward. scope 'server' requires guild admin; scope 'global'
 *     requires the Pulsify operator.
 */
export async function GET(req: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params
  const manage = new URL(req.url).searchParams.get('manage') === '1'

  const auth = await requireGuildRole(guildId, manage ? 'admin' : 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const rewards = await loadGuildShop(supabase, guildId, { includeInactive: manage })
  const [context, ownedCounts] = await Promise.all([
    getBuyerContext(supabase, guildId, auth.access.userId),
    getOwnedCounts(supabase, auth.access.userId, rewards.map((r) => r.id)),
  ])

  return NextResponse.json({
    rewards,
    context,
    ownedCounts,
    isAdmin: auth.access.role === 'admin',
    isOperator: auth.access.isOperator,
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const scope: RewardScope = (body as { scope?: string })?.scope === 'global' ? 'global' : 'server'

  // Authorise by scope: global rewards are operator-only; server rewards admin.
  let actorId: string | null = null
  if (scope === 'global') {
    const gate = await requireOperator()
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403 })
    actorId = gate.userId
  } else {
    const auth = await requireGuildRole(guildId, 'admin')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    actorId = auth.access.userId
  }

  const parsed = sanitizeRewardInput(body, scope)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const supabase = await createClient()

  // Cap the number of rewards a guild can define.
  if (scope === 'server') {
    const { count } = await supabase
      .from('shop_rewards')
      .select('id', { count: 'exact', head: true })
      .eq('scope', 'server')
      .eq('guild_id', guildId)
    if ((count ?? 0) >= REWARD_LIMITS.maxRewardsPerGuild) {
      return NextResponse.json(
        { error: `You can define at most ${REWARD_LIMITS.maxRewardsPerGuild} rewards.` },
        { status: 409 },
      )
    }
  }

  const actor = await getCurrentDiscordUser()
  const { value } = parsed
  const { data, error } = await supabase
    .from('shop_rewards')
    .insert({
      scope,
      guild_id: scope === 'global' ? null : guildId,
      category: value.category,
      name: value.name,
      description: value.description,
      cost: value.cost,
      stock: value.stock,
      stock_remaining: value.stock,
      per_user_limit: value.per_user_limit,
      active: value.active,
      featured: value.featured,
      sort: value.sort,
      icon: value.icon,
      color: value.color,
      image_url: value.image_url,
      payload: value.payload,
      requirements: value.requirements,
      created_by: actor?.userId ?? actorId,
    })
    .select('*')
    .single()

  if (error) {
    console.warn('[Pulse] shop reward create failed:', error.message)
    return NextResponse.json({ error: 'Could not create the reward. Try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, reward: data })
}
