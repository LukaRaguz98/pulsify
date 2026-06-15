import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that require a signed-in user — an invalid session here bounces to the
// landing page. Everything else still runs through the proxy (to refresh the
// session cookie), it just doesn't get redirected when signed out.
const PROTECTED_ROUTES = ['/dashboard', '/workspace', '/billing']

// The Supabase session lives in chunked `sb-<ref>-auth-token[.n]` cookies. This
// matches those — but deliberately NOT the transient PKCE `…-code-verifier`
// cookie (also `sb-…-auth-token…`), which must survive an in-flight sign-in or
// the OAuth exchange breaks.
const isSupabaseAuthCookie = (name: string) =>
  name.startsWith('sb-') && name.includes('auth-token') && !name.includes('code-verifier')

// Our self-managed Discord OAuth token cache (lib/discord-session.ts) — orphaned
// once the Supabase login is gone, so we clear it alongside.
const DISCORD_SESSION_COOKIE = 'pulsify-discord-session'

/**
 * Tear down a dead session: strip the auth cookies from the forwarded request
 * (so the downstream render on THIS request already reads as signed-out and
 * can't throw on the dead token) AND expire them on the response (so the browser
 * drops them). Without this the browser keeps presenting a stale (rotated/used)
 * refresh token that can never succeed, and every request fails until the user
 * manually deletes the cookie. Returns the rebuilt response carrying the request
 * mutations.
 */
function clearDeadSession(request: NextRequest): NextResponse {
  const toClear = request.cookies
    .getAll()
    .map((c) => c.name)
    .filter((name) => isSupabaseAuthCookie(name) || name === DISCORD_SESSION_COOKIE)
  for (const name of toClear) request.cookies.delete(name)
  const response = NextResponse.next({ request })
  for (const name of toClear) response.cookies.set(name, '', { maxAge: 0, path: '/' })
  return response
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Validate + (if the access token expired) refresh the session on EVERY
  // request. This MUST run in the proxy: a Server Component render can't write
  // cookies, so it's the only place a rotated refresh token gets persisted back
  // to the browser. Without it the cookie keeps a stale token after ~1h and
  // every later request fails — the "still logged in but everything errors
  // until I clear the cookie" report.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  // Distinguish a genuinely-dead session (expired/rotated/invalid refresh token)
  // from a transient outage: only a 4xx auth error means the token can never
  // work again. A 5xx / network blip must NOT log a valid user out.
  const hasAuthCookie = request.cookies.getAll().some((c) => isSupabaseAuthCookie(c.name))
  const sessionIsDead =
    !user && hasAuthCookie && !!error && (error.status === 400 || error.status === 401 || error.status === 403)

  if (sessionIsDead) {
    supabaseResponse = clearDeadSession(request)
  }

  if (!user && PROTECTED_ROUTES.some((route) => request.nextUrl.pathname.startsWith(route))) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    const redirect = NextResponse.redirect(url)
    // Carry over cookie mutations (esp. the auth-cookie clears) — a bare
    // redirect response would otherwise drop them and the dead session would
    // survive the bounce, re-looping on the next visit.
    for (const c of supabaseResponse.cookies.getAll()) redirect.cookies.set(c)
    return redirect
  }

  return supabaseResponse
}

export const config = {
  // Run on every route so the session is refreshed (and a dead one cleared)
  // wherever the user lands — not just protected routes. Excludes Next internals,
  // static assets, the bot's server-to-server API (no user session there), and
  // the `/auth` OAuth callback (it mints the session + owns its own cookies; the
  // proxy must not touch the in-flight PKCE exchange).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/bot|auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf)$).*)',
  ],
}
