import 'server-only'
import { getCurrentDiscordUser } from '@/lib/workspace-auth'
import { fetchDiscordUser } from '@/lib/discord'

/**
 * Bot-operator gate. Some surfaces (e.g. the global bot Presence) are bot-wide,
 * not per-server, so they should only be editable by the people who run the
 * Pulsify deployment — not by every server admin.
 *
 * Operators are identified by their Discord user ID, listed (comma-separated)
 * in the server-only `PULSIFY_OPERATOR_IDS` env var. In production you set this
 * to your own Discord ID on the host (Vercel/Docker/etc.):
 *
 *   PULSIFY_OPERATOR_IDS=123456789012345678
 *
 * Kept server-only so the allowlist never ships to the client; every gate is
 * enforced in a server action / server component regardless.
 */
export function getOperatorIds(): string[] {
  const raw = process.env.PULSIFY_OPERATOR_IDS ?? ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{15,21}$/.test(s))
}

/** True if the given Discord user ID is a configured operator. */
export function isOperator(userId: string | null | undefined): boolean {
  if (!userId) return false
  return getOperatorIds().includes(userId)
}

/** Convenience: is the currently signed-in user an operator? */
export async function isCurrentUserOperator(): Promise<boolean> {
  const actor = await getCurrentDiscordUser()
  return isOperator(actor?.userId)
}

export type Operator = { id: string; name: string }

/**
 * Resolve the configured operators to their Discord display names (bot token,
 * cached). Falls back to the raw id when a lookup fails. Used to tell viewers
 * who can see/manage bot-wide surfaces like the Presence view.
 */
export async function getOperators(): Promise<Operator[]> {
  const ids = getOperatorIds()
  return Promise.all(
    ids.map(async (id) => {
      const user = await fetchDiscordUser(id)
      return { id, name: user?.global_name ?? user?.username ?? id }
    }),
  )
}

export type OperatorGateResult =
  | { ok: true; userId: string }
  | { ok: false; error: string }

/**
 * Server-action gate: the caller must be signed in AND a configured operator.
 * Returns the operator's Discord user ID on success.
 */
export async function requireOperator(): Promise<OperatorGateResult> {
  const actor = await getCurrentDiscordUser()
  if (!actor) return { ok: false, error: 'You must be signed in.' }
  if (!isOperator(actor.userId)) {
    return { ok: false, error: 'Only the Pulsify operator can change the bot’s presence.' }
  }
  return { ok: true, userId: actor.userId }
}
