import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import {
  applySettingsRetention,
  fetchCoplay,
  gamingWindow,
  getGamingSettings,
} from '@/lib/gaming-query'
import { isTimeframe, type Timeframe } from '@/lib/analytics'
import { buildSquads } from '@/lib/gaming'
import { requireGuildFeature } from '@/lib/billing-server'

/**
 * GET /api/guilds/[guildId]/gaming/squads
 *
 * Members who actually play together — same game, overlapping wall clock. The
 * pair-wise overlap is computed in SQL (get_gaming_coplay) and grouped into
 * connected components here (buildSquads).
 *
 * Its own route because it is the module's most expensive query by a distance:
 * a self-join over the session table. Keeping it off the main payload means the
 * overview still loads fast on a server where squad detection is slow, and the
 * panel can fetch lazily when the admin scrolls to it.
 *
 * Query params:
 *   `timeframe`  — 24h | 7d | 30d | all, the shared analytics selector.
 *   `minMinutes` — minimum shared playtime before a pair counts (default 15).
 *                  Below that you are looking at coincidence, not a squad.
 */

const DEFAULT_TIMEFRAME: Timeframe = '30d'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params

  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const tfParam = url.searchParams.get('timeframe')
  const timeframe: Timeframe = isTimeframe(tfParam) ? tfParam : DEFAULT_TIMEFRAME
  const minMinutes = Math.min(
    24 * 60,
    Math.max(1, Number(url.searchParams.get('minMinutes')) || 15),
  )

  // Squad detection is the paid half of the module. Gated here rather than in
  // the UI alone, because this is also the module's heaviest query — a plan
  // check that only hides a tab would still let the cost through.
  const gate = await requireGuildFeature(guildId, 'advancedGamingAnalytics')
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.error, locked: true, current: gate.current, required: gate.required },
      { status: 402 },
    )
  }

  const supabase = await createClient()
  const settings = await getGamingSettings(supabase, guildId)

  if (!settings.enabled) {
    return NextResponse.json({ enabled: false, squads: [], pairs: [] })
  }

  const window = applySettingsRetention(await gamingWindow(guildId, timeframe), settings)

  const result = await fetchCoplay(supabase, guildId, window.since, minMinutes * 60)
  if ('error' in result) {
    return NextResponse.json({ error: `Squad detection failed: ${result.error}` }, { status: 500 })
  }

  return NextResponse.json({
    enabled: true,
    anonymise: settings.anonymizeStats,
    window: { timeframe: window.timeframe, days: window.days, since: window.since, minMinutes },
    // Pairs are returned alongside the squads because the UI shows both: the
    // grouped squads, and — when you open one — who specifically plays with whom.
    pairs: result.pairs,
    squads: buildSquads(result.pairs),
  })
}
