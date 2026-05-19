import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { clearDiscordSession } from '@/lib/discord-session'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // Drop our Discord token cache too, otherwise the next visitor in this
  // browser would inherit the previous user's Discord identity.
  await clearDiscordSession()
  const origin = request.nextUrl.origin
  return NextResponse.redirect(`${origin}/`)
}
