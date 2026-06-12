import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'

const MAX_LIMIT = 100

/**
 * GET /api/guilds/[guildId]/economy/transactions
 *   ?scope=guild|global      rows from this server only, or economy-wide (default guild)
 *   &kind=earn|spend|...     coin ledger kind filter
 *   &reason=activity|...     reason filter
 *   &q=text                  matches member / counterparty / actor name or note
 *   &user=discord_id         a single member's history
 *   &audit=1                 only administrative adjustments (economy mod log)
 *   &activity=1              include the per-message/per-voice-minute earnings
 *                            (hidden by default — they flood the ledger)
 *   &offset=0&limit=50       pagination (exact total returned)
 *
 * Paged, filterable read over the coin ledger — the Transactions tab and the
 * admin-action audit log are both views over this endpoint.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  // The ledger is part of the member-visible economy (it carries no
  // management data — every row describes coin movement members can see).
  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const sp = new URL(req.url).searchParams

  const scope = sp.get('scope') === 'global' ? 'global' : 'guild'
  const kind = sp.get('kind')?.trim() || null
  const reason = sp.get('reason')?.trim() || null
  const q = sp.get('q')?.trim() || null
  const userId = sp.get('user')?.trim() || null
  const offset = Math.max(0, Number(sp.get('offset')) || 0)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(sp.get('limit')) || 50))

  let query = supabase
    .from('economy_transactions')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (scope === 'guild') query = query.eq('guild_id', guildId)
  // audit=1 → only administrative adjustments (the economy moderation log).
  if (sp.get('audit') === '1') query = query.in('kind', ['admin_grant', 'admin_remove'])
  if (kind) query = query.eq('kind', kind)
  if (reason) query = query.eq('reason', reason)
  if (userId) query = query.eq('user_id', userId)
  // Per-message / per-voice-minute activity earnings are written one row each, so
  // they swamp the ledger (thousands of tiny grants). Hide them by default;
  // `activity=1` opts them back in. Skipped when a specific reason is requested
  // or in the admin audit view, so those stay exact.
  const includeActivity = sp.get('activity') === '1'
  if (!includeActivity && !reason && sp.get('audit') !== '1') {
    query = query.neq('reason', 'activity')
  }
  if (q) {
    // Escape PostgREST or() syntax characters so a search term can't break
    // the filter expression.
    const safe = q.replace(/[,()%]/g, ' ').trim()
    if (safe) {
      const cols = ['user_name', 'counterparty_name', 'actor_name', 'note', 'guild_name']
      query = query.or(cols.map((c) => `${c}.ilike.%${safe}%`).join(','))
    }
  }

  const { data, count, error } = await query
  if (error) {
    return NextResponse.json({ error: 'Failed to load transactions.' }, { status: 500 })
  }

  return NextResponse.json({
    rows: data ?? [],
    total: count ?? 0,
    offset,
    limit,
  })
}
