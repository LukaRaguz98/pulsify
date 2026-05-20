/**
 * Shared shape for the per-server bot branding API. Kept in a neutral module
 * (no server-only imports) so both the route handler and the client editor can
 * import it without coupling the component to a server route module.
 */
export type BotBrandingResponse = {
  /** Live branding from Discord. */
  current: { nickname: string | null; avatarUrl: string | null }
  /** Bot's global identity — the fallback when nothing custom is set. */
  default: { name: string; avatarUrl: string | null }
  /** What the bot is allowed to do here. Unknown perms are treated as allowed. */
  permissions: { inGuild: boolean; canChangeNickname: boolean; canChangeAvatar: boolean }
  /** Whether any custom branding is currently applied. */
  hasCustomBranding: boolean
  /** Last dashboard change, from our records. */
  lastUpdated: { at: string; by: string | null } | null
}
