import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { requireGuildLimit } from '@/lib/billing-server'
import { createClient } from '@/lib/supabase-server'
import { computeStatValues } from '@/lib/statistics-values'
import {
  validateStatChannelDraft,
  statMeta,
  STAT_LIMITS,
  type StatChannelDraft,
} from '@/lib/statistics-channels'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()
  const [rowsRes, values] = await Promise.all([
    supabase
      .from('statistics_channels')
      .select('*')
      .eq('guild_id', guildId)
      .order('position', { ascending: true })
      .limit(200),
    // Best-effort live snapshot for the dashboard preview + list. Never fail the
    // whole request on a transient Discord/analytics hiccup.
    computeStatValues(supabase, guildId).catch(() => ({})),
  ])

  return NextResponse.json({ channels: rowsRes.data ?? [], values })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Partial<StatChannelDraft> & {
    allowDuplicate?: boolean
  }

  const draft: StatChannelDraft = {
    stat_type: body.stat_type!,
    // Statistic channels are always locked voice channels now (the category
    // variant was removed — it couldn't be made reliably visible on Discord).
    channel_type: 'voice',
    name_template: String(body.name_template ?? '').trim(),
    category_id: body.category_id ? String(body.category_id) : null,
    update_mode: body.update_mode === 'manual' ? 'manual' : 'auto',
    visibility: body.visibility === 'admins' ? 'admins' : 'everyone',
    enabled: body.enabled !== false,
  }

  const validationError = validateStatChannelDraft(draft)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const supabase = await createClient()

  // Cap the number of stat channels per guild.
  const { data: existing } = await supabase
    .from('statistics_channels')
    .select('id, stat_type, position')
    .eq('guild_id', guildId)
  const rows = existing ?? []
  if (rows.length >= STAT_LIMITS.maxChannels) {
    return NextResponse.json(
      { error: `You can have at most ${STAT_LIMITS.maxChannels} statistic channels per server.` },
      { status: 400 },
    )
  }
  // Plan limit (PULSIFY-62): stat channels per guild, gated on the server
  // owner's plan (tighter than the technical STAT_LIMITS ceiling above).
  const statLimit = await requireGuildLimit(guildId, 'maxStatisticChannels', rows.length)
  if (!statLimit.ok) return NextResponse.json({ error: statLimit.error }, { status: 403 })
  // Soft duplicate guard — one channel per statistic unless explicitly allowed.
  if (!body.allowDuplicate && rows.some((r) => r.stat_type === draft.stat_type)) {
    return NextResponse.json(
      {
        error: `A "${statMeta(draft.stat_type)?.label ?? draft.stat_type}" channel already exists.`,
        code: 'duplicate',
      },
      { status: 409 },
    )
  }

  const nextPosition = rows.reduce((max, r) => Math.max(max, Number(r.position) || 0), -1) + 1
  const now = new Date().toISOString()

  const { data: inserted, error } = await supabase
    .from('statistics_channels')
    .insert({
      guild_id: guildId,
      channel_type: draft.channel_type,
      stat_type: draft.stat_type,
      name_template: draft.name_template,
      category_id: draft.category_id,
      position: nextPosition,
      enabled: draft.enabled,
      update_mode: draft.update_mode,
      visibility: draft.visibility,
      created_by: auth.moderator.userId,
      created_by_name: auth.moderator.username,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single()

  if (error || !inserted) {
    return NextResponse.json(
      { error: `Failed to create the statistic channel: ${error?.message ?? 'unknown error'}` },
      { status: 500 },
    )
  }

  return NextResponse.json(inserted)
}
