import { createClient as createServerSupabase } from '@/lib/supabase-server'
import {
  fetchUserGuilds,
  hasManageGuild,
  fetchSelfUser,
  DiscordFetchError,
  type DiscordGuild,
} from '@/lib/discord'

export type ModeratorContext = {
  userId: string
  /** Display name: global_name (or full_name fallback) — what to put in titles. */
  username: string | null
  /** Raw @handle — used for the "(username)" suffix in notification detail views. */
  handle: string | null
}

export type AuthResult =
  | { ok: true; moderator: ModeratorContext }
  | { ok: false; error: string }

/**
 * Verify the current Supabase user is signed in AND has Manage Server / Administrator
 * on the Discord guild they're trying to moderate. Returns the moderator's Discord
 * identity for logging.
 */
export async function authorizeGuildModerator(guildId: string): Promise<AuthResult> {
  const supabase = await createServerSupabase()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'You must be signed in.' }

  const token = session.provider_token
  if (!token) return { ok: false, error: 'Your Discord session expired — please sign in again.' }

  let guilds: DiscordGuild[]
  try {
    guilds = await fetchUserGuilds(token)
  } catch (e) {
    // Transient Discord failure (rate limit, 5xx, network blip). Surface a
    // retry-friendly message instead of the misleading "not a member" error.
    const status = e instanceof DiscordFetchError ? e.status : 0
    return {
      ok: false,
      error:
        status === 401
          ? 'Your Discord session expired — please sign in again.'
          : "Couldn't verify your Discord access right now. Try again in a moment.",
    }
  }
  const guild = guilds.find((g) => g.id === guildId)
  if (!guild) return { ok: false, error: 'You are not a member of this server.' }
  if (!hasManageGuild(guild.permissions)) {
    return { ok: false, error: 'You need Manage Server or Administrator on this server.' }
  }

  const claims = session.user.user_metadata?.custom_claims as
    | { username?: string; global_name?: string }
    | undefined
  let moderatorId =
    (session.user.user_metadata?.provider_id as string | undefined) ?? session.user.id
  let moderatorUsername =
    claims?.global_name ?? claims?.username ?? session.user.user_metadata?.full_name ?? null
  let moderatorHandle = claims?.username ?? null

  // Fetch the live Discord identity so logs always have a username, even if
  // the metadata claims are missing.
  if (!moderatorUsername || !moderatorHandle) {
    const self = await fetchSelfUser(token)
    if (self) {
      moderatorId = self.id
      if (!moderatorUsername) moderatorUsername = self.global_name ?? self.username
      if (!moderatorHandle) moderatorHandle = self.username
    }
  }

  return {
    ok: true,
    moderator: { userId: moderatorId, username: moderatorUsername, handle: moderatorHandle },
  }
}
