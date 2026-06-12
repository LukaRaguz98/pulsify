import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getCurrentDiscordUser } from '@/lib/workspace-auth'
import { normalisePurchase, ownedCosmetics, cosmeticEffects } from '@/lib/shop'

/**
 * GET /api/me/cosmetics
 *
 * The signed-in member's owned cosmetics, GLOBALLY (their Pulse identity travels
 * across servers, so no guild scope). Drives unlock checks for functional
 * cosmetics — e.g. the Animated Corner HUD decoration, which is bought in the
 * shop and then toggled on in Preferences. Returns the owned cosmetic items plus
 * the distinct effect keys (e.g. ["corner_hud"]).
 */
export async function GET() {
  const user = await getCurrentDiscordUser()
  if (!user?.userId) return NextResponse.json({ effects: [], cosmetics: [] })

  const supabase = await createClient()
  const { data } = await supabase
    .from('reward_purchases')
    .select('id, reward_snapshot, status, enabled, created_at')
    .eq('user_id', user.userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(200)

  const purchases = (data ?? []).map((r) => normalisePurchase(r as Record<string, unknown>))
  return NextResponse.json({
    effects: cosmeticEffects(purchases),
    cosmetics: ownedCosmetics(purchases),
  })
}
