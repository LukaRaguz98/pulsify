import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { getCurrentDiscordUser } from '@/lib/workspace-auth'
import { fetchGuild, addMemberRoleDiscord } from '@/lib/discord'
import {
  meetsRequirements,
  computeExpiry,
  rolePayload,
  CATEGORY_META,
  type PurchaseFulfilment,
  type ShopReward,
} from '@/lib/shop'
import { loadReward, getBuyerContext } from '@/lib/shop-server'

// Decide the purchase's initial inventory state by reward category:
//   role            → granted now by the web app (pending → fulfilled below).
//   badge/cosmetic  → nothing to fulfil; owned = fulfilled.
//   xp_booster      → owned, awaiting the member to activate it.
//   giveaway_entry  → the bot grants the entries (stays pending for the bot).
//   perk/custom/event → staff fulfil on redemption (manual).
function initialState(reward: ShopReward): {
  status: 'active'
  fulfillment: PurchaseFulfilment
  expiresAt: string | null
} {
  const f = CATEGORY_META[reward.category].fulfilment
  if (reward.category === 'role') {
    return { status: 'active', fulfillment: 'pending', expiresAt: computeExpiry(reward) }
  }
  if (f === 'cosmetic') return { status: 'active', fulfillment: 'fulfilled', expiresAt: null }
  if (f === 'manual') return { status: 'active', fulfillment: 'manual', expiresAt: null }
  // bot-fulfilled (booster awaiting activation, giveaway entries)
  return { status: 'active', fulfillment: 'pending', expiresAt: null }
}

const RESULT_STATUS: Record<string, number> = {
  not_found: 404,
  inactive: 409,
  out_of_stock: 409,
  limit_reached: 409,
  insufficient_balance: 402,
}

const RESULT_MESSAGE: Record<string, string> = {
  not_found: 'That reward no longer exists.',
  inactive: 'That reward is no longer available.',
  out_of_stock: 'That reward is out of stock.',
  limit_reached: "You've already bought the maximum of this reward.",
  insufficient_balance: "You don't have enough Pulse Coins for this.",
}

export async function POST(req: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params

  // Buying is part of the member experience — any member may purchase.
  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const userId = auth.access.userId

  let body: { rewardId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!body.rewardId) return NextResponse.json({ error: 'No reward specified.' }, { status: 400 })

  const supabase = await createClient()
  const reward = await loadReward(supabase, body.rewardId)
  if (!reward || !reward.active) {
    return NextResponse.json({ error: 'That reward is not available.' }, { status: 404 })
  }
  // A server reward is only buyable from its own guild; global rewards anywhere.
  if (reward.scope === 'server' && reward.guild_id !== guildId) {
    return NextResponse.json({ error: 'That reward belongs to another server.' }, { status: 403 })
  }

  // Computed requirements (reputation / level / achievements) are checked here;
  // balance / stock / per-user limit are enforced atomically by the RPC.
  const context = await getBuyerContext(supabase, guildId, userId)
  const gate = meetsRequirements(reward, context)
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reasons.join(' '), reasons: gate.reasons }, { status: 403 })
  }

  const actor = await getCurrentDiscordUser()
  const userName = actor?.username ?? actor?.handle ?? null
  const guild = await fetchGuild(guildId).catch(() => null)
  const { status, fulfillment, expiresAt } = initialState(reward)

  const snapshot = {
    name: reward.name,
    category: reward.category,
    scope: reward.scope,
    icon: reward.icon,
    color: reward.color,
    image_url: reward.image_url,
    description: reward.description,
    payload: reward.payload,
  }

  const { data, error } = await supabase.rpc('economy_purchase', {
    p_user_id: userId,
    p_user_name: userName,
    p_reward_id: reward.id,
    p_guild_id: guildId,
    p_guild_name: guild?.name ?? null,
    p_reward_snapshot: snapshot,
    p_expires_at: expiresAt,
    p_status: status,
    p_fulfillment: fulfillment,
  })
  if (error) {
    console.warn('[Pulse] economy_purchase failed:', error.message)
    return NextResponse.json({ error: 'Something went wrong buying that. Try again.' }, { status: 500 })
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { result: string; balance: number | null; purchase_id: string | null; cost: number | null }
    | null
  const result = row?.result ?? 'not_found'
  if (result !== 'ok') {
    return NextResponse.json(
      { error: RESULT_MESSAGE[result] ?? 'That purchase could not be completed.' },
      { status: RESULT_STATUS[result] ?? 409 },
    )
  }

  const purchaseId = row!.purchase_id!
  let newBalance = Number(row!.balance ?? 0)

  // Discord role rewards are granted immediately via REST. On failure, refund
  // so the member is never charged for a role they didn't receive.
  if (reward.category === 'role') {
    const { roleId } = rolePayload(reward)
    const granted = roleId
      ? await addMemberRoleDiscord(guildId, userId, roleId, `Pulse shop: ${reward.name}`)
      : { ok: false as const, error: 'No role configured.' }
    if (granted.ok) {
      await supabase.from('reward_purchases').update({ fulfillment: 'fulfilled' }).eq('id', purchaseId)
    } else {
      const { data: refund } = await supabase.rpc('economy_refund_purchase', {
        p_purchase_id: purchaseId,
        p_actor_id: null,
        p_actor_name: 'auto-refund',
      })
      const rRow = (Array.isArray(refund) ? refund[0] : refund) as { balance: number | null } | null
      if (rRow?.balance != null) newBalance = Number(rRow.balance)
      return NextResponse.json(
        { error: "Couldn't assign the role (check the bot's role position). You were refunded." },
        { status: 502 },
      )
    }
  }

  return NextResponse.json({ ok: true, balance: newBalance, purchaseId })
}
