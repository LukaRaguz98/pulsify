import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { normalisePurchase, coerceCategory, REWARD_LIMITS } from '@/lib/shop'

const HOUR_MS = 3_600_000

/**
 * POST /api/guilds/[guildId]/economy/inventory/[purchaseId]
 * Activate (XP boosters) or redeem (manual perks/custom/event rewards) an owned
 * inventory item. The buyer acts on their own purchases only. Boosters start
 * their timer here (the bot applies the multiplier + the sweep expires it);
 * manual rewards are marked consumed and the bot announces the redemption to
 * staff.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ guildId: string; purchaseId: string }> },
) {
  const { guildId, purchaseId } = await params
  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const { data: rawRow } = await supabase
    .from('reward_purchases')
    .select('*')
    .eq('id', purchaseId)
    .maybeSingle()
  if (!rawRow) return NextResponse.json({ error: 'Item not found.' }, { status: 404 })

  const purchase = normalisePurchase(rawRow as Record<string, unknown>)
  if (purchase.user_id !== auth.access.userId) {
    return NextResponse.json({ error: 'That item is not yours.' }, { status: 403 })
  }
  if (purchase.status !== 'active') {
    return NextResponse.json({ error: 'That item can no longer be used.' }, { status: 409 })
  }

  const category = coerceCategory(purchase.reward_snapshot.category)
  const payload = (purchase.reward_snapshot.payload ?? {}) as Record<string, unknown>
  const now = new Date()

  if (category === 'xp_booster') {
    if (purchase.activated_at) {
      return NextResponse.json({ error: 'That booster is already active.' }, { status: 409 })
    }
    const hours = Math.max(
      1,
      Math.min(REWARD_LIMITS.maxBoosterHours, Number(payload.duration_hours) || 24),
    )
    const { error } = await supabase
      .from('reward_purchases')
      .update({
        activated_at: now.toISOString(),
        expires_at: new Date(now.getTime() + hours * HOUR_MS).toISOString(),
        fulfillment: 'fulfilled',
      })
      .eq('id', purchaseId)
    if (error) return NextResponse.json({ error: 'Could not activate the booster.' }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'activated' })
  }

  // Custom perks: redeem = consume + let staff fulfil. Cosmetics/roles/
  // giveaway-entries are not redeemable here. (Legacy custom/event map to perk.)
  if (category === 'perk') {
    const { error } = await supabase
      .from('reward_purchases')
      .update({ status: 'consumed', activated_at: now.toISOString() })
      .eq('id', purchaseId)
    if (error) return NextResponse.json({ error: 'Could not redeem the reward.' }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'redeemed' })
  }

  return NextResponse.json({ error: 'This item does not need activating.' }, { status: 400 })
}

/**
 * PATCH /api/guilds/[guildId]/economy/inventory/[purchaseId]
 * Toggle an owned COSMETIC on/off from the member's Inventory (`{ enabled }`).
 * A disabled cosmetic stops rendering everywhere (profile chips, Corner HUD).
 * The buyer acts on their own purchases only.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string; purchaseId: string }> },
) {
  const { guildId, purchaseId } = await params
  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { enabled?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Pass { enabled: boolean }.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: rawRow } = await supabase
    .from('reward_purchases')
    .select('*')
    .eq('id', purchaseId)
    .maybeSingle()
  if (!rawRow) return NextResponse.json({ error: 'Item not found.' }, { status: 404 })

  const purchase = normalisePurchase(rawRow as Record<string, unknown>)
  if (purchase.user_id !== auth.access.userId) {
    return NextResponse.json({ error: 'That item is not yours.' }, { status: 403 })
  }
  if (coerceCategory(purchase.reward_snapshot.category) !== 'cosmetic') {
    return NextResponse.json({ error: 'Only cosmetics can be toggled.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('reward_purchases')
    .update({ enabled: body.enabled })
    .eq('id', purchaseId)
  if (error) return NextResponse.json({ error: 'Could not update the cosmetic.' }, { status: 500 })
  return NextResponse.json({ ok: true, enabled: body.enabled })
}
