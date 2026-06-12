import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { requireOperator } from '@/lib/operator'
import { sanitizeRewardInput } from '@/lib/shop'
import { loadReward } from '@/lib/shop-server'

// Authorise a write against an existing reward: global rewards are operator-only;
// server rewards require admin on the OWNING guild. Returns null on success or a
// NextResponse error to return.
async function authoriseRewardWrite(guildId: string, reward: { scope: string; guild_id: string | null }) {
  if (reward.scope === 'global') {
    const gate = await requireOperator()
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403 })
    return null
  }
  if (reward.guild_id !== guildId) {
    return NextResponse.json({ error: 'That reward belongs to another server.' }, { status: 403 })
  }
  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  return null
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string; rewardId: string }> },
) {
  const { guildId, rewardId } = await params
  const supabase = await createClient()

  const existing = await loadReward(supabase, rewardId)
  if (!existing) return NextResponse.json({ error: 'Reward not found.' }, { status: 404 })

  const denied = await authoriseRewardWrite(guildId, existing)
  if (denied) return denied

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const parsed = sanitizeRewardInput(body, existing.scope)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const v = parsed.value

  // Preserve sold count: shift stock_remaining by the change in total stock
  // (null total = unlimited → remaining null).
  let stockRemaining: number | null
  if (v.stock == null) {
    stockRemaining = null
  } else {
    const sold = (existing.stock ?? 0) - (existing.stock_remaining ?? 0)
    stockRemaining = Math.max(0, v.stock - Math.max(0, sold))
  }

  const { data, error } = await supabase
    .from('shop_rewards')
    .update({
      category: v.category,
      name: v.name,
      description: v.description,
      cost: v.cost,
      stock: v.stock,
      stock_remaining: stockRemaining,
      per_user_limit: v.per_user_limit,
      active: v.active,
      featured: v.featured,
      sort: v.sort,
      icon: v.icon,
      color: v.color,
      image_url: v.image_url,
      payload: v.payload,
      requirements: v.requirements,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rewardId)
    .select('*')
    .single()

  if (error) {
    console.warn('[Pulse] shop reward update failed:', error.message)
    return NextResponse.json({ error: 'Could not update the reward. Try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, reward: data })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ guildId: string; rewardId: string }> },
) {
  const { guildId, rewardId } = await params
  const supabase = await createClient()

  const existing = await loadReward(supabase, rewardId)
  if (!existing) return NextResponse.json({ error: 'Reward not found.' }, { status: 404 })

  const denied = await authoriseRewardWrite(guildId, existing)
  if (denied) return denied

  // Purchases keep their snapshot (reward_id FK is ON DELETE SET NULL), so
  // history/inventory survive deleting the definition.
  const { error } = await supabase.from('shop_rewards').delete().eq('id', rewardId)
  if (error) {
    console.warn('[Pulse] shop reward delete failed:', error.message)
    return NextResponse.json({ error: 'Could not delete the reward. Try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
