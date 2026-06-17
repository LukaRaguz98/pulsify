import 'server-only'
import { cookies } from 'next/headers'

/**
 * Self-managed Discord OAuth token cache.
 *
 * Supabase only populates `session.provider_token` immediately after the OAuth
 * exchange; on every subsequent supabase session refresh (every ~1h) it strips
 * the provider token. After that the dashboard would think "Discord session
 * expired" even though the underlying refresh token is still valid.
 *
 * We work around it by snapshotting both tokens to our own HttpOnly cookie at
 * callback time and using Discord's token endpoint to refresh access tokens
 * silently. Consumers should always go through `getValidDiscordToken()` rather
 * than reading `session.provider_token` directly.
 */

const COOKIE_NAME = 'pulsify-discord-session'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
// Refresh tokens are typically valid for 30+ days. We treat the cookie as
// "valid as long as the refresh token is present" and trust Discord to reject
// stale refresh tokens with a 4xx — handled in `refreshDiscordToken`.
const REFRESH_LEEWAY_MS = 60 * 1000 // refresh proactively a minute before expiry

const DISCORD_TOKEN_URL = 'https://discord.com/api/v10/oauth2/token'

type DiscordSession = {
  access_token: string
  refresh_token: string
  /** Absolute ms epoch when the access_token expires. */
  expires_at: number
  /** Scopes the user granted — informational. */
  scope?: string
}

type DiscordTokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  scope: string
}

function clientCredentials(): { id: string; secret: string } | null {
  const id = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID
  const secret = process.env.DISCORD_CLIENT_SECRET
  if (!id || !secret) return null
  return { id, secret }
}

async function readCookie(): Promise<DiscordSession | null> {
  const store = await cookies()
  const raw = store.get(COOKIE_NAME)?.value
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<DiscordSession>
    if (!parsed.access_token || !parsed.refresh_token || typeof parsed.expires_at !== 'number') {
      return null
    }
    return parsed as DiscordSession
  } catch {
    return null
  }
}

async function writeCookie(session: DiscordSession): Promise<void> {
  const store = await cookies()
  try {
    // `cookies().set()` throws when called during a Server Component render
    // (it's only allowed in Server Actions / Route Handlers). We refresh the
    // Discord token lazily from read paths like `getValidDiscordToken`, which
    // can run during render — swallowing the error there is safe because the
    // in-memory token is still returned and the cookie gets rewritten on the
    // next mutation-capable request.
    store.set(COOKIE_NAME, JSON.stringify(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      // Pin to the refresh-token lifetime: Discord docs say refresh tokens don't
      // strictly expire, but practically they go stale ~30d after last use. We
      // give the cookie a year, then rely on refresh failure to clear it.
      maxAge: ONE_YEAR_SECONDS,
    })
  } catch {
    // Ignore — running in a context where cookies can't be set (render).
  }
}

export async function clearDiscordSession(): Promise<void> {
  const store = await cookies()
  try {
    store.delete(COOKIE_NAME)
  } catch {
    // Ignore — running in a context where cookies can't be modified (render).
  }
}

/**
 * Persist a freshly-obtained Discord token pair. Called from the OAuth
 * callback right after `supabase.auth.exchangeCodeForSession` so the cookie
 * is populated before the user lands on the dashboard.
 */
export async function setDiscordSessionFromOAuth(input: {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
}): Promise<void> {
  await writeCookie({
    access_token: input.access_token,
    refresh_token: input.refresh_token,
    expires_at: Date.now() + input.expires_in * 1000,
    scope: input.scope,
  })
}

async function refreshDiscordToken(refreshToken: string): Promise<DiscordSession | null> {
  const creds = clientCredentials()
  if (!creds) return null

  const body = new URLSearchParams({
    client_id: creds.id,
    client_secret: creds.secret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  let res: Response
  try {
    res = await fetch(DISCORD_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch {
    return null
  }
  if (!res.ok) {
    // 400/401 from Discord means the refresh token is dead — drop the cookie
    // so the next request triggers a clean re-auth instead of a refresh loop.
    if (res.status === 400 || res.status === 401) {
      await clearDiscordSession()
    }
    return null
  }
  const data = (await res.json()) as DiscordTokenResponse
  const next: DiscordSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  }
  await writeCookie(next)
  return next
}

/**
 * Return a Discord access token, refreshing first if it's expired or about
 * to expire. Returns null when no refresh token is available — that's the
 * caller's cue to redirect through the OAuth flow.
 *
 * Pass in `fallbackProviderToken` (from `session.provider_token`) when you
 * have one — we'll prefer it on the very first call after login, before our
 * own cookie has been populated (e.g. older sessions created before this
 * feature shipped).
 */
export async function getValidDiscordToken(
  fallback?: { access_token?: string | null; refresh_token?: string | null } | null,
): Promise<string | null> {
  let session = await readCookie()

  // Migration path: if no cookie yet but Supabase still has the original
  // tokens, seed our cookie so future calls survive supabase refreshes.
  if (!session && fallback?.access_token && fallback?.refresh_token) {
    session = {
      access_token: fallback.access_token,
      refresh_token: fallback.refresh_token,
      // We don't know the real expiry — assume Discord's default 604800s (7d).
      expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
    }
    await writeCookie(session)
  }

  if (!session) {
    // Pure-Supabase fallback: an old supabase session that has an access
    // token but no refresh token. Hand it back so existing flows still work
    // until the user next logs in.
    return fallback?.access_token ?? null
  }

  if (session.expires_at - Date.now() > REFRESH_LEEWAY_MS) {
    return session.access_token
  }

  const refreshed = await refreshDiscordToken(session.refresh_token)
  return refreshed?.access_token ?? null
}

/**
 * Same as `getValidDiscordToken` but returns full status so callers can
 * distinguish "valid" from "refresh failed → reconnect required".
 */
export type DiscordTokenStatus =
  | { ok: true; accessToken: string }
  | { ok: false; reason: 'missing' | 'refresh_failed' }

export async function getDiscordTokenStatus(
  fallback?: { access_token?: string | null; refresh_token?: string | null } | null,
): Promise<DiscordTokenStatus> {
  const session = await readCookie()
  if (!session) {
    if (fallback?.access_token && fallback?.refresh_token) {
      const t = await getValidDiscordToken(fallback)
      return t ? { ok: true, accessToken: t } : { ok: false, reason: 'refresh_failed' }
    }
    if (fallback?.access_token) {
      return { ok: true, accessToken: fallback.access_token }
    }
    return { ok: false, reason: 'missing' }
  }
  if (session.expires_at - Date.now() > REFRESH_LEEWAY_MS) {
    return { ok: true, accessToken: session.access_token }
  }
  const refreshed = await refreshDiscordToken(session.refresh_token)
  if (refreshed) return { ok: true, accessToken: refreshed.access_token }
  return { ok: false, reason: 'refresh_failed' }
}
