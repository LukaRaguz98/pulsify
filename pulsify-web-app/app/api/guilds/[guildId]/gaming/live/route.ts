import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { fetchLive, getGamingSettings } from '@/lib/gaming-query'
import { anonymiseLiveSessions } from '@/lib/gaming'

/**
 * GET /api/guilds/[guildId]/gaming/live
 *
 * Who is playing right now. Its own route because the live panel polls on a
 * short cadence and must not drag the whole analytics payload along with it —
 * this reads one small indexed slice (`gaming_sessions_open`).
 *
 * Durations are NOT computed here. The response carries `startedAt` and the
 * client ticks the elapsed time locally, so a card counts up smoothly between
 * polls instead of freezing at whatever the server said several seconds ago.
 *
 * OPEN TO MEMBERS, in a narrower shape. "Who is playing right now" is the one
 * part of Gaming that is useful to the community itself rather than to whoever
 * runs it, so any member may read it — but two things are withheld from them:
 *
 *   • the voice channel, because a member cannot be shown to have access to the
 *     channel someone is sitting in, and a staff channel's occupants are not
 *     community information; and
 *   • identity, whenever the server anonymises statistics — stripped from the
 *     rows themselves rather than hidden by the client.
 *
 * Authorisation uses the REAL role; the redaction below uses the EFFECTIVE one,
 * so an operator previewing Member View sees what a member would actually see.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params

  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isAdmin = auth.access.effectiveRole === 'admin'

  const supabase = await createClient()
  const settings = await getGamingSettings(supabase, guildId)

  if (!settings.enabled) {
    return NextResponse.json({ enabled: false, live: [], anonymise: settings.anonymizeStats })
  }

  const result = await fetchLive(supabase, guildId)
  if ('error' in result) {
    return NextResponse.json({ error: `Live activity failed: ${result.error}` }, { status: 500 })
  }

  let live = result.live
  if (!isAdmin) {
    live = live.map((s) => ({ ...s, voiceChannelId: null, voiceChannelName: null }))
  }
  if (settings.anonymizeStats && !isAdmin) live = anonymiseLiveSessions(live)

  return NextResponse.json({
    enabled: true,
    anonymise: settings.anonymizeStats,
    live,
    fetchedAt: new Date().toISOString(),
  })
}
