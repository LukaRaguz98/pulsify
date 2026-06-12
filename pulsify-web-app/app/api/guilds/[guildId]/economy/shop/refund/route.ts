import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { requireOperator } from '@/lib/operator'
import { getCurrentDiscordUser } from '@/lib/workspace-auth'
import { removeMemberRoleDiscord } from '@/lib/discord'
import { normalisePurchase } from '@/lib/shop'

/**
 * POST /api/guilds/[guildId]/economy/shop/refund  { purchaseId }
 * Refund a purchase: credit the coins back, restore stock, flag it refunded and
 * — for a granted role — remove the role. Server-reward refunds require admin on
 * the owning guild; global-reward refunds require the Pulsify operator.
 */
export async function POST(req: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params

  let body: { purchaseId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!body.purchaseId) return NextResponse.json({ error: 'No purchase specified.' }, { status: 400 })

  const supabase = await createClient()
  const { data: rawRow } = await supabase
    .from('reward_purchases')
    .select('*')
    .eq('id', body.purchaseId)
    .maybeSingle()
  if (!rawRow) return NextResponse.json({ error: 'Purchase not found.' }, { status: 404 })
  const purchase = normalisePurchase(rawRow as Record<string, unknown>)

  if (purchase.status === 'refunded') {
    return NextResponse.json({ error: 'That purchase was already refunded.' }, { status: 409 })
  }

  // Authorise by the reward's scope (snapshot survives reward deletion).
  const scope = String(purchase.reward_snapshot.scope ?? 'server')
  let actorId: string | null = null
  let actorName: string | null = null
  if (scope === 'global') {
    const gate = await requireOperator()
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403 })
    actorId = gate.userId
  } else {
    if (purchase.guild_id !== guildId) {
      return NextResponse.json({ error: 'That purchase belongs to another server.' }, { status: 403 })
    }
    const auth = await requireGuildRole(guildId, 'admin')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    actorId = auth.access.userId
  }
  const actor = await getCurrentDiscordUser()
  actorName = actor?.username ?? actor?.handle ?? null

  // Remove a granted role before crediting coins back.
  const category = String(purchase.reward_snapshot.category ?? '')
  if (category === 'role' && purchase.fulfillment === 'fulfilled') {
    const roleId = String((purchase.reward_snapshot.payload as Record<string, unknown>)?.role_id ?? '')
    if (roleId && purchase.guild_id) {
      await removeMemberRoleDiscord(purchase.guild_id, purchase.user_id, roleId, 'Pulse shop refund').catch(
        () => {},
      )
    }
  }

  const { data, error } = await supabase.rpc('economy_refund_purchase', {
    p_purchase_id: purchase.id,
    p_actor_id: actorId,
    p_actor_name: actorName,
  })
  if (error) {
    console.warn('[Pulse] economy_refund_purchase failed:', error.message)
    return NextResponse.json({ error: 'Could not refund. Try again.' }, { status: 500 })
  }
  const row = (Array.isArray(data) ? data[0] : data) as { result: string; balance: number | null } | null
  if (row?.result === 'already_refunded') {
    return NextResponse.json({ error: 'That purchase was already refunded.' }, { status: 409 })
  }
  if (row?.result !== 'ok') {
    return NextResponse.json({ error: 'Could not refund that purchase.' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, balance: Number(row.balance ?? 0) })
}
