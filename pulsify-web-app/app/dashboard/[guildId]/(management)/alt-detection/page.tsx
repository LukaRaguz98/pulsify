import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild } from '@/lib/discord'
import { loadGuildRiskContext, scoreGuild } from '@/lib/alt-detection-server'
import {
  buildLinkGroups,
  RISK_LEVELS,
  STATUS_META,
  type AltAccountSummary,
  type AltDashboardStats,
  type AltInvestigation,
  type AltInvestigationEvent,
  type AltLink,
  type AltLookup,
  type AltRiskLevel,
} from '@/lib/alt-detection'
import { AltDetectionContent } from '@/components/dashboard/alt-detection/AltDetectionContent'

// How many scored accounts the risk list ships to the client. The dashboard is a
// triage surface — the tail of a healthy server is thousands of "Low" rows
// nobody will read, and the Lookup tab resolves any specific account on demand.
const RISK_LIST_LIMIT = 100

export default async function AltDetectionPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const [guild, ctx, { data: investigationRows }, { data: eventRows }, { data: linkRows }, { data: lookupRows }] =
    await Promise.all([
      fetchGuild(guildId),
      loadGuildRiskContext(supabase, guildId),
      supabase
        .from('alt_investigations')
        .select('*')
        .eq('guild_id', guildId)
        .order('risk_score', { ascending: false })
        .limit(200),
      supabase
        .from('alt_investigation_events')
        .select('*')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('alt_account_links').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }),
      supabase
        .from('alt_lookups')
        .select('*')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: false })
        .limit(50),
    ])
  if (!guild) redirect('/dashboard')

  const scored = scoreGuild(ctx)

  const byLevel = Object.fromEntries(RISK_LEVELS.map((l) => [l, 0])) as Record<AltRiskLevel, number>
  for (const s of scored) byLevel[s.risk.level]++

  // The list itself: elevated accounts first. A server with nothing above "Low"
  // gets an empty state rather than a hundred rows of noise.
  const accounts: AltAccountSummary[] = scored
    .filter((s) => s.risk.level !== 'low')
    .slice(0, RISK_LIST_LIMIT)
    .map((s) => ({
      userId: s.userId,
      username: s.username,
      displayName: s.displayName,
      avatar: s.avatar,
      joinedAt: s.joinedAt,
      accountCreatedAt: s.accountCreatedAt,
      score: s.risk.score,
      level: s.risk.level,
      signals: s.risk.signals
        .filter((sig) => sig.tone === 'risk')
        .slice(0, 3)
        .map((sig) => sig.label),
    }))

  const investigations = (investigationRows ?? []) as AltInvestigation[]
  const events = (eventRows ?? []) as AltInvestigationEvent[]
  const links = (linkRows ?? []) as AltLink[]
  const lookups = (lookupRows ?? []) as AltLookup[]

  const stats: AltDashboardStats = {
    scanned: scored.length,
    byLevel,
    actionable: byLevel.high + byLevel.critical,
    openCases: investigations.filter((i) => !STATUS_META[i.status]?.resolved).length,
    resolvedCases: investigations.filter((i) => STATUS_META[i.status]?.resolved).length,
    linkedGroups: buildLinkGroups(links).length,
  }

  // Avatars for accounts that appear in cases/links/lookups but fell outside the
  // risk list (a banned evader, a member who left) — resolved from the members we
  // already loaded, so the client never has to guess a CDN URL.
  const avatars: Record<string, string> = {}
  for (const s of scored) avatars[s.userId] = s.avatar

  return (
    <AltDetectionContent
      guildId={guildId}
      guildName={guild.name}
      stats={stats}
      accounts={accounts}
      investigations={investigations}
      events={events}
      links={links}
      lookups={lookups}
      avatars={avatars}
    />
  )
}
