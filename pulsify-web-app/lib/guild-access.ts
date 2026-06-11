import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase-server'
import { getValidDiscordToken } from '@/lib/discord-session'
import { fetchUserGuilds, hasManageGuild } from '@/lib/discord'
import { isOperator } from '@/lib/operator'

// Guild access model (PULSIFY-45 member access).
//
// Pulsify is no longer admin-only: every Discord member of a server can sign
// in and get a READ-ONLY view of the community surfaces (profile, reputation,
// leaderboards, statistics, economy, events, giveaways, announcements), while
// management stays behind Manage Server / Administrator.
//
//   role            — what the user actually is on this guild:
//                     'admin'  = Manage Server or Administrator
//                     'member' = in the guild without management permissions
//   effectiveRole   — what the UI should render. Differs from `role` only for
//                     operators previewing the dashboard in Member View.
//
// Member View is an OPERATOR-ONLY preview (cookie-driven). The cookie can only
// ever DOWNGRADE an operator's experience, never elevate anyone — API routes
// authorise against the real `role`, not the cookie.

export const MEMBER_VIEW_COOKIE = 'pulsify-member-view'

export type GuildRole = 'admin' | 'member'

export type GuildAccess = {
  /** The viewer's Discord user id. */
  userId: string
  /** Real role on this guild (operators are always at least admin). */
  role: GuildRole
  isOperator: boolean
  /** Operator-only Member View preview is active. */
  memberView: boolean
  /** Role the UI should render (role, downgraded by Member View). */
  effectiveRole: GuildRole
}

/**
 * Resolve the signed-in user's access to a guild. Returns null when the user
 * is signed out, their Discord session can't be verified, or they are not a
 * member of the guild (fail closed). Cached per request.
 */
export const getGuildAccess = cache(
  async (guildId: string): Promise<GuildAccess | null> => {
    const supabase = await createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return null

    const userId =
      (session.user.user_metadata?.provider_id as string | undefined) ?? session.user.id
    const operator = isOperator(userId)

    let role: GuildRole | null = null
    const token = await getValidDiscordToken({
      access_token: session.provider_token,
      refresh_token: session.provider_refresh_token,
    })
    if (token) {
      try {
        const guilds = await fetchUserGuilds(token)
        const guild = guilds.find((g) => g.id === guildId)
        if (guild) role = hasManageGuild(guild.permissions) ? 'admin' : 'member'
      } catch {
        // Transient Discord failure (rate limit, 5xx, network) — fail closed;
        // the user can retry. Operators still get their fallback below.
      }
    }

    // Operators always have full access, even to guilds they aren't in.
    if (operator) role = 'admin'
    if (!role) return null

    // Member View: operator-only preview of the member experience.
    const cookieStore = await cookies()
    const memberView =
      operator && role === 'admin' && cookieStore.get(MEMBER_VIEW_COOKIE)?.value === '1'

    return {
      userId,
      role,
      isOperator: operator,
      memberView,
      effectiveRole: memberView ? 'member' : role,
    }
  },
)

export type GuildAuthResult =
  | { ok: true; access: GuildAccess }
  | { ok: false; error: string; status: number }

/**
 * API-route gate. `minimum: 'member'` admits any member of the guild;
 * `minimum: 'admin'` requires Manage Server / Administrator. Authorises
 * against the REAL role — the Member View preview cookie never changes what
 * the API will serve.
 */
export async function requireGuildRole(
  guildId: string,
  minimum: GuildRole,
): Promise<GuildAuthResult> {
  const access = await getGuildAccess(guildId)
  if (!access) {
    return { ok: false, error: 'You do not have access to this server.', status: 403 }
  }
  if (minimum === 'admin' && access.role !== 'admin') {
    return {
      ok: false,
      error: 'You need Manage Server or Administrator on this server.',
      status: 403,
    }
  }
  return { ok: true, access }
}
