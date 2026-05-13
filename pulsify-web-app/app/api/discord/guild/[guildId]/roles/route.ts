import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildRoles } from '@/lib/discord'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId } = await params
  const roles = await fetchGuildRoles(guildId)
  return NextResponse.json(roles)
}
