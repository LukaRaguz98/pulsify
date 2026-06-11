import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { fetchGuildMembers } from '@/lib/discord'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId } = await params
  // Management data — requires Manage Server / Administrator on this guild.
  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 1000)
  const members = await fetchGuildMembers(guildId, limit)
  return NextResponse.json(members)
}
