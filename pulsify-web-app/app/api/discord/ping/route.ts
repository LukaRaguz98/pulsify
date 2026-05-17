import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

/**
 * GET /api/discord/ping
 *
 * Measures the round-trip latency from this Next.js server to Discord's
 * public `/gateway` endpoint and returns it as `{ latency, ok }`.
 *
 * `/gateway` is unauthenticated and tiny (just `{url: "wss://..."}`) so it's
 * the cheapest health check we can hit without burning auth quota or
 * triggering bot-specific rate limits.
 *
 * Auth-gated to a signed-in Supabase user so a public DDoS amplifier this
 * isn't — only the dashboard can poll it.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const start = performance.now()
  try {
    const res = await fetch('https://discord.com/api/v10/gateway', { cache: 'no-store' })
    const latency = Math.round(performance.now() - start)
    return NextResponse.json({ latency, ok: res.ok })
  } catch {
    return NextResponse.json({ latency: null, ok: false }, { status: 503 })
  }
}
