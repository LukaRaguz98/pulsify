import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { createClient } from '@/lib/supabase-server'
import { deleteChannel } from '@/lib/discord'
import { validateStatChannelDraft, type StatChannelDraft } from '@/lib/statistics-channels'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string; id: string }> },
) {
  const { guildId, id } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Partial<StatChannelDraft>

  const supabase = await createClient()
  const { data: current } = await supabase
    .from('statistics_channels')
    .select('*')
    .eq('guild_id', guildId)
    .eq('id', id)
    .maybeSingle()
  if (!current) return NextResponse.json({ error: 'Statistic channel not found.' }, { status: 404 })

  // Merge, then validate the resulting draft.
  const draft: StatChannelDraft = {
    stat_type: (body.stat_type ?? current.stat_type) as StatChannelDraft['stat_type'],
    // Always voice — the category variant was removed.
    channel_type: 'voice',
    name_template: String(body.name_template ?? current.name_template).trim(),
    category_id: body.category_id !== undefined ? (body.category_id || null) : current.category_id,
    update_mode: (body.update_mode ?? current.update_mode) as StatChannelDraft['update_mode'],
    visibility: (body.visibility ?? current.visibility ?? 'everyone') as StatChannelDraft['visibility'],
    enabled: body.enabled !== undefined ? body.enabled : current.enabled,
  }
  const validationError = validateStatChannelDraft(draft)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const { data: updated, error } = await supabase
    .from('statistics_channels')
    .update({
      stat_type: draft.stat_type,
      channel_type: draft.channel_type,
      name_template: draft.name_template,
      category_id: draft.category_id,
      update_mode: draft.update_mode,
      visibility: draft.visibility,
      enabled: draft.enabled,
      // Force a fresh render on the next sync (the value/name may have changed).
      last_value: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('guild_id', guildId)
    .eq('id', id)
    .select('*')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: `Failed to save: ${error?.message ?? 'unknown error'}` }, { status: 500 })
  }
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ guildId: string; id: string }> },
) {
  const { guildId, id } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()
  // Grab the provisioned Discord channel id first, then delete the row and the
  // channel. We delete the channel directly (rather than relying on the bot's
  // realtime teardown) so removal is reliable even if the bot is offline or the
  // realtime delete payload is missing columns.
  const { data: row } = await supabase
    .from('statistics_channels')
    .select('channel_id')
    .eq('guild_id', guildId)
    .eq('id', id)
    .maybeSingle()

  const { error } = await supabase
    .from('statistics_channels')
    .delete()
    .eq('guild_id', guildId)
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (row?.channel_id) {
    await deleteChannel(row.channel_id, 'Statistics channel removed via dashboard').catch(() => {})
  }
  return NextResponse.json({ ok: true })
}
