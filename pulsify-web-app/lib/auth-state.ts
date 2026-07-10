import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase-server'
import { getDiscordTokenStatus } from '@/lib/discord-session'

/**
 * Whether the visitor can actually open the dashboard right now. Used by the
 * landing / public headers to choose "Open Dashboard" vs "Sign in".
 *
 * A plain `getSession()` isn't enough for this decision — it trusts the cookie
 * without validating it, so an expired session still looks signed-in and the
 * header wrongly offers "Open Dashboard". And even a valid Supabase session is
 * useless if the Discord connection is dead: the user would click through only
 * to hit the "Reconnect Discord" screen. So we require BOTH:
 *
 *   1. a network-validated Supabase user (`getUser()` checks the token with the
 *      auth server and returns null for an expired/invalid session), and
 *   2. a usable Discord token (refreshable, not the reconnect state).
 *
 * Only then is "Open Dashboard" honest; otherwise the header falls back to the
 * sign-in CTA. Cached per request so multiple header/CTA reads share one check.
 */
export const isDashboardReady = cache(async (): Promise<boolean> => {
  const supabase = await createClient()

  // getUser() validates against the auth server (unlike getSession(), which
  // only reads the cookie) — an expired session returns no user here.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false

  // A valid Supabase session still needs a live Discord token; if it can't be
  // refreshed the user would land on the Reconnect screen, so treat that as
  // "not ready" and let the header show "Sign in" instead of "Open Dashboard".
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const status = await getDiscordTokenStatus({
    access_token: session?.provider_token,
    refresh_token: session?.provider_refresh_token,
  })
  return status.ok
})
