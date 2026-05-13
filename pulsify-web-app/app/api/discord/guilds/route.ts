import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { fetchUserGuilds, isBotInGuild, hasManageGuild } from '@/lib/discord'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const providerToken = session.provider_token
  if (!providerToken) {
    return NextResponse.json({ error: 'No Discord token' }, { status: 401 })
  }

  const guilds = await fetchUserGuilds(providerToken)
  const managed = guilds.filter((g) => hasManageGuild(g.permissions))

  const guildsWithBotStatus = await Promise.all(
    managed.map(async (guild) => ({
      ...guild,
      botInstalled: await isBotInGuild(guild.id),
    }))
  )

  return NextResponse.json(guildsWithBotStatus)
}
