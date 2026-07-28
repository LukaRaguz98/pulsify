import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { getGamingSettings } from '@/lib/gaming-query'
import {
  normaliseGamingSettings,
  serialiseGamingSettings,
  gameKey,
  type GamingSettings,
} from '@/lib/gaming'
import { recordNotification } from '@/lib/notifications-server'

/**
 * GET / PATCH /api/guilds/[guildId]/gaming/settings
 *
 * The module's privacy and collection configuration. The bot reads this table
 * through a realtime subscription, so a change here takes effect on the next
 * presence event — there is no restart and no sweep to wait for.
 *
 * Turning `enabled` off stops collection immediately but deletes nothing;
 * existing sessions stay queryable if it is switched back on. That is stated on
 * the settings page too — silently destroying history on a toggle would be the
 * wrong default for a module whose entire value is history.
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params

  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const settings = await getGamingSettings(supabase, guildId)

  const { data: optOuts } = await supabase
    .from('gaming_opt_outs')
    .select('user_id, purge_history, created_at')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ settings, optOuts: optOuts ?? [] })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params

  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: Partial<GamingSettings>
  try {
    body = (await req.json()) as Partial<GamingSettings>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const supabase = await createClient()
  const current = await getGamingSettings(supabase, guildId)

  // Re-normalise through the same path the bot uses, so a value the dashboard
  // accepts can never be one the collector would reject.
  const merged: GamingSettings = normaliseGamingSettings({
    enabled: body.enabled ?? current.enabled,
    settings: serialiseGamingSettings({
      ...current,
      ...body,
      // Ignored games are entered as display names and compared as keys — doing
      // the normalisation here means an admin typing "Rocket League" excludes
      // "rocket league" as the bot sees it.
      ignoredGames: (body.ignoredGames ?? current.ignoredGames).map((g) => gameKey(g)),
    }),
  })

  const { error } = await supabase.from('gaming_settings').upsert(
    {
      guild_id: guildId,
      enabled: merged.enabled,
      settings: serialiseGamingSettings(merged),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'guild_id' },
  )

  if (error) {
    return NextResponse.json({ error: `Couldn't save settings: ${error.message}` }, { status: 500 })
  }

  // Enabling or disabling presence collection is exactly the kind of change the
  // server's history should record — it changes what Pulsify observes about
  // every member.
  if (merged.enabled !== current.enabled) {
    await recordNotification({
      guildId,
      type: 'gaming_tracking_toggled',
      title: merged.enabled ? 'Gaming tracking enabled' : 'Gaming tracking disabled',
      body: merged.enabled
        ? 'Pulse is now recording play sessions from Discord presence.'
        : 'Pulse has stopped recording play sessions. Existing history is kept.',
      link: `/dashboard/${guildId}/gaming-settings`,
      actorId: auth.access.userId,
    })
  }

  return NextResponse.json({ settings: merged })
}
