import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { fetchChannelMessages } from '@/lib/discord'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string; channelId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { channelId } = await params
  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100)

  const messages = await fetchChannelMessages(channelId, limit)
  return NextResponse.json(messages)
}
