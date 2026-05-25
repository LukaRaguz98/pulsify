// Single source of truth for public-facing contact + community links, so the
// legal / support / community pages and the footers can all be updated in one
// place. Swap these placeholders for the real addresses before public launch.
export const SITE = {
  name: 'Pulsify',
  supportEmail: 'Govadroth@hotmail.com',
  privacyEmail: 'Govadroth@hotmail.com',
  /** Public Discord community invite (permanent — never expires). */
  discordInvite: 'https://discord.gg/JqWyEmepTc',
  twitter: 'https://x.com/pulsifyapp',
  github: 'https://github.com/pulsify-app',
  /** Human-readable date the legal documents were last reviewed. */
  legalLastUpdated: 'May 23, 2026',
} as const
