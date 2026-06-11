import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { isOperator } from '@/lib/operator'
import { getCurrentDiscordUser } from '@/lib/workspace-auth'
import { fetchGuild } from '@/lib/discord'
import { isTimeframe, timeframeSince, type Timeframe } from '@/lib/analytics'
import {
  ADMIN_ADJUST_LIMITS,
  buildEconomyAnalytics,
  normaliseEconomyUser,
  type EconomyTransaction,
} from '@/lib/economy'

const LEADERBOARD_LIMIT = 25
const SERVER_LEADERBOARD_LIMIT = 100
// Cap on windowed ledger rows fed into analytics — plenty for trend charts
// while keeping the response bounded on very busy economies.
const WINDOW_ROW_LIMIT = 5000

/**
 * GET /api/guilds/[guildId]/economy?timeframe=24h|7d|30d|all
 *
 * Everything the Economy view needs in one go: whole-economy totals, windowed
 * coin analytics (earned/spent trends, top earners), the global coin
 * leaderboards (richest / most active) and this server's leaderboard (members
 * ranked by local XP, joined with their global balance). Timeframe matches the
 * analytics/statistics views. Any member of the guild may read it — the
 * economy is part of the member experience. Reputation isn't here: it's the
 * computed trust score shown on member profiles, not a coin leaderboard.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const tfParam = new URL(req.url).searchParams.get('timeframe')
  const timeframe: Timeframe = isTimeframe(tfParam) ? tfParam : '30d'
  // null for 'all' (no lower bound).
  const since = timeframeSince(timeframe)

  const [totalsRes, richestRes, activeRes, serverLevelsRes, txRes] = await Promise.all([
    supabase.rpc('economy_totals'),
    supabase
      .from('economy_users')
      .select('*')
      .order('balance', { ascending: false })
      .limit(LEADERBOARD_LIMIT),
    supabase
      .from('economy_users')
      .select('*')
      .order('lifetime_earned', { ascending: false })
      .limit(LEADERBOARD_LIMIT),
    supabase
      .from('member_levels')
      .select('user_id, user_name, xp, level')
      .eq('guild_id', guildId)
      .order('xp', { ascending: false })
      .limit(SERVER_LEADERBOARD_LIMIT),
    (() => {
      let q = supabase
        .from('economy_transactions')
        .select('id, user_id, user_name, guild_id, guild_name, amount, balance_after, kind, reason, note, counterparty_id, counterparty_name, actor_id, actor_name, created_at')
        .order('created_at', { ascending: false })
        .limit(WINDOW_ROW_LIMIT)
      if (since) q = q.gte('created_at', since)
      return q
    })(),
  ])

  const totalsRow = Array.isArray(totalsRes.data) ? totalsRes.data[0] : totalsRes.data
  const circulation = Number(totalsRow?.circulation ?? 0)
  const userCount = Number(totalsRow?.user_count ?? 0)

  const transactions = (txRes.data ?? []) as EconomyTransaction[]
  const analytics = buildEconomyAnalytics(transactions, circulation, timeframe)

  // This server's leaderboard: local level/XP joined with the global balance.
  const serverLevels = serverLevelsRes.data ?? []
  const serverIds = serverLevels.map((r) => r.user_id)
  let walletById = new Map<string, ReturnType<typeof normaliseEconomyUser>>()
  if (serverIds.length > 0) {
    const { data: wallets } = await supabase
      .from('economy_users')
      .select('*')
      .in('user_id', serverIds)
    walletById = new Map(
      (wallets ?? []).map((w) => {
        const u = normaliseEconomyUser(w as Record<string, unknown>)
        return [u.user_id, u] as const
      }),
    )
  }
  const server = serverLevels.map((r) => {
    const wallet = walletById.get(r.user_id) ?? null
    return {
      user_id: r.user_id,
      user_name: r.user_name ?? null,
      xp: Number(r.xp ?? 0),
      level: Number(r.level ?? 0),
      balance: wallet?.balance ?? 0,
    }
  })

  return NextResponse.json({
    timeframe,
    totals: { circulation, userCount },
    analytics,
    leaderboards: {
      richest: (richestRes.data ?? []).map((r) => normaliseEconomyUser(r as Record<string, unknown>)),
      active: (activeRes.data ?? []).map((r) => normaliseEconomyUser(r as Record<string, unknown>)),
      server,
    },
  })
}

type AdjustAction = 'grant_coins' | 'remove_coins'

const ACTIONS: AdjustAction[] = ['grant_coins', 'remove_coins']

/**
 * POST /api/guilds/[guildId]/economy
 * Body: { action, userId, userName?, amount, note? }
 *
 * Administrative coin adjustment. The economy is bot-wide (a single global
 * balance per user spans every server), so granting/removing coins is an
 * OPERATOR action — restricted to the people who run the Pulsify deployment,
 * not individual server admins (same gate as bot Presence). The operator's
 * Discord identity is recorded on the ledger row, which the Controls tab shows
 * as the economy moderation log.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params

  let body: {
    action?: string
    userId?: string
    userName?: string
    amount?: number
    note?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const action = body.action as AdjustAction
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!/^\d{5,25}$/.test(userId)) {
    return NextResponse.json({ error: 'A valid member id is required.' }, { status: 400 })
  }
  const amount = Number(body.amount)
  if (!Number.isInteger(amount) || amount < 1 || amount > ADMIN_ADJUST_LIMITS.maxCoins) {
    return NextResponse.json(
      { error: `Amount must be a whole number between 1 and ${ADMIN_ADJUST_LIMITS.maxCoins.toLocaleString()}.` },
      { status: 400 },
    )
  }
  const note =
    typeof body.note === 'string' && body.note.trim()
      ? body.note.trim().slice(0, ADMIN_ADJUST_LIMITS.maxNote)
      : null

  const actor = await getCurrentDiscordUser()
  if (!actor) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  if (!isOperator(actor.userId)) {
    return NextResponse.json(
      { error: 'Only the Pulsify operator can adjust the global economy.' },
      { status: 403 },
    )
  }

  const supabase = await createClient()
  const guild = await fetchGuild(guildId).catch(() => null)
  const userName = typeof body.userName === 'string' && body.userName.trim() ? body.userName.trim() : null

  const signed = action === 'grant_coins' ? amount : -amount
  const { data, error } = await supabase.rpc('economy_adjust', {
    p_user_id: userId,
    p_user_name: userName,
    p_amount: signed,
    p_kind: action === 'grant_coins' ? 'admin_grant' : 'admin_remove',
    p_reason: 'admin',
    p_note: note,
    p_guild_id: guildId,
    p_guild_name: guild?.name ?? null,
    p_actor_id: actor.userId,
    p_actor_name: actor.username ?? actor.handle ?? null,
  })
  if (error) return NextResponse.json({ error: 'Adjustment failed. Try again.' }, { status: 500 })
  if (data === null) {
    return NextResponse.json(
      { error: "That removal exceeds the member's balance — balances can't go below zero." },
      { status: 409 },
    )
  }
  return NextResponse.json({ ok: true, balance: Number(data) })
}
