import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildMember } from '@/lib/discord'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string; userId: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId, userId } = await params
  const member = await fetchGuildMember(guildId, userId)
  if (!member) {
    return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  }
  return NextResponse.json(member)
}
