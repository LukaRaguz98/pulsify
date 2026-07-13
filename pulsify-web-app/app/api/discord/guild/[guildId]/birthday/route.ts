import { NextResponse } from 'next/server'
import { requireGuildRole } from '@/lib/guild-access'
import { createClient } from '@/lib/supabase-server'
import { validateBirthday, isValidTimeZone } from '@/lib/birthdays'

/**
 * Member-authored birthday. Any member of the guild may read + write their OWN
 * row (user_id is always taken from the authenticated session, never the body,
 * so a member can't set someone else's birthday). Mirrors the /birthday set
 * slash command.
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const { data } = await supabase
    .from('member_birthdays')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', auth.access.userId)
    .maybeSingle()
  return NextResponse.json({ birthday: data ?? null })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const month = Number(body.month)
  const day = Number(body.day)
  const yearRaw = body.year == null || body.year === '' ? null : Number(body.year)
  const year = yearRaw && yearRaw > 0 ? yearRaw : null
  const tzRaw = typeof body.timezone === 'string' ? body.timezone : null
  const timezone = tzRaw && isValidTimeZone(tzRaw) ? tzRaw : null
  const showYear = body.show_year == null ? true : Boolean(body.show_year)
  const announce = body.announce == null ? true : Boolean(body.announce)

  const err = validateBirthday(month, day, year)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    (user?.user_metadata?.user_name as string | undefined) ??
    null

  const { error } = await supabase.from('member_birthdays').upsert(
    {
      guild_id: guildId,
      user_id: auth.access.userId,
      user_name: userName,
      birth_month: month,
      birth_day: day,
      birth_year: year,
      timezone,
      show_year: showYear,
      announce,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'guild_id,user_id' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await requireGuildRole(guildId, 'member')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const { error } = await supabase
    .from('member_birthdays')
    .delete()
    .eq('guild_id', guildId)
    .eq('user_id', auth.access.userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
