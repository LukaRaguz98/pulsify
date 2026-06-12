import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { normalisePurchase } from '@/lib/shop'

/**
 * GET /api/guilds/[guildId]/economy/inventory
 * The viewer's GLOBAL inventory — every reward they've bought across any Pulse
 * server (owned / active / expired / refunded + purchase history). Any member
 * may read their own. The guild in the path only authorises membership.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params
  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const { data } = await supabase
    .from('reward_purchases')
    .select('*')
    .eq('user_id', auth.access.userId)
    .order('created_at', { ascending: false })
    .limit(200)

  return NextResponse.json({ purchases: (data ?? []).map((r) => normalisePurchase(r as Record<string, unknown>)) })
}
