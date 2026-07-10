import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { createClient } from '@/lib/supabase-server'
import { deleteChannel } from '@/lib/discord'
import { STAT_LIMITS } from '@/lib/statistics-channels'

type BulkBody =
  | { action: 'enable' | 'disable' | 'delete'; ids: string[] }
  | { action: 'duplicate'; ids: string[] }
  | { action: 'reorder'; order: string[] }
  | { action: 'sync'; ids?: string[] }

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as BulkBody
  const supabase = await createClient()
  const now = new Date().toISOString()

  switch (body.action) {
    case 'enable':
    case 'disable': {
      const ids = body.ids ?? []
      if (ids.length === 0) return NextResponse.json({ ok: true })
      const { error } = await supabase
        .from('statistics_channels')
        .update({ enabled: body.action === 'enable', last_error: null, updated_at: now })
        .eq('guild_id', guildId)
        .in('id', ids)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    case 'delete': {
      const ids = body.ids ?? []
      if (ids.length === 0) return NextResponse.json({ ok: true })
      // Capture the provisioned channels before deleting the rows so we can tear
      // them down directly (reliable even if the bot is offline).
      const { data: rows } = await supabase
        .from('statistics_channels')
        .select('channel_id')
        .eq('guild_id', guildId)
        .in('id', ids)
      const { error } = await supabase
        .from('statistics_channels')
        .delete()
        .eq('guild_id', guildId)
        .in('id', ids)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await Promise.all(
        (rows ?? [])
          .map((r) => r.channel_id)
          .filter((cid): cid is string => !!cid)
          .map((cid) => deleteChannel(cid, 'Statistics channel removed via dashboard').catch(() => {})),
      )
      return NextResponse.json({ ok: true })
    }

    case 'duplicate': {
      const ids = body.ids ?? []
      if (ids.length === 0) return NextResponse.json({ channels: [] })
      const { data: sources } = await supabase
        .from('statistics_channels')
        .select('*')
        .eq('guild_id', guildId)
        .in('id', ids)
      const { count } = await supabase
        .from('statistics_channels')
        .select('*', { count: 'exact', head: true })
        .eq('guild_id', guildId)
      const existing = count ?? 0
      if (!sources || sources.length === 0) return NextResponse.json({ channels: [] })
      if (existing + sources.length > STAT_LIMITS.maxChannels) {
        return NextResponse.json(
          { error: `Duplicating would exceed the ${STAT_LIMITS.maxChannels} statistic channel limit.` },
          { status: 400 },
        )
      }
      let basePosition = existing
      const inserts = sources.map((s) => ({
        guild_id: guildId,
        // Always voice — the category variant was removed.
        channel_type: 'voice',
        stat_type: s.stat_type,
        name_template: s.name_template,
        category_id: s.category_id,
        position: basePosition++,
        // Duplicates start disabled so a second live channel isn't provisioned
        // by surprise — the admin enables it deliberately.
        enabled: false,
        update_mode: s.update_mode,
        visibility: s.visibility ?? 'everyone',
        created_by: auth.moderator.userId,
        created_by_name: auth.moderator.username,
        created_at: now,
        updated_at: now,
      }))
      const { data: created, error } = await supabase
        .from('statistics_channels')
        .insert(inserts)
        .select('*')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ channels: created ?? [] })
    }

    case 'reorder': {
      const order = body.order ?? []
      // Persist the new ordering by index. Small N, so per-row updates are fine.
      await Promise.all(
        order.map((id, i) =>
          supabase
            .from('statistics_channels')
            .update({ position: i, updated_at: now })
            .eq('guild_id', guildId)
            .eq('id', id),
        ),
      )
      return NextResponse.json({ ok: true })
    }

    case 'sync': {
      // Nudge the bot to refresh now (its realtime handler watches this column).
      let q = supabase
        .from('statistics_channels')
        .update({ sync_requested_at: now, updated_at: now })
        .eq('guild_id', guildId)
      if (body.ids && body.ids.length > 0) q = q.in('id', body.ids)
      const { error } = await q
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
}
