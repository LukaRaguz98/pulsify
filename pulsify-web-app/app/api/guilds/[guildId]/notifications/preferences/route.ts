import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { NOTIFICATION_TYPES, type NotificationType } from '@/lib/notifications'

const TYPE_SET = new Set<string>(NOTIFICATION_TYPES)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const supabase = await createClient()
  const { data } = await supabase
    .from('notification_preferences')
    .select('enabled_types, toast_enabled')
    .eq('user_id', auth.moderator.userId)
    .eq('guild_id', guildId)
    .maybeSingle()

  return NextResponse.json({
    enabled_types: (data?.enabled_types ?? {}) as Record<string, boolean>,
    toast_enabled: data?.toast_enabled ?? true,
  })
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    enabled_types?: Record<string, boolean>
    toast_enabled?: boolean
  }

  // Strip unknown type keys so a typo client-side doesn't bloat the row.
  const sanitized: Record<NotificationType, boolean> = {} as Record<NotificationType, boolean>
  if (body.enabled_types && typeof body.enabled_types === 'object') {
    for (const [key, value] of Object.entries(body.enabled_types)) {
      if (TYPE_SET.has(key) && typeof value === 'boolean') {
        sanitized[key as NotificationType] = value
      }
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('notification_preferences')
    .upsert(
      {
        user_id: auth.moderator.userId,
        guild_id: guildId,
        enabled_types: sanitized,
        toast_enabled: typeof body.toast_enabled === 'boolean' ? body.toast_enabled : true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,guild_id' },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
