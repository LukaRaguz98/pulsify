import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
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
  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 1000)
  const members = await fetchGuildMembers(guildId, limit)
  return NextResponse.json(members)
}
