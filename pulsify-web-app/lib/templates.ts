// Server Templates (PULSIFY-36, reframed in PULSIFY-52) — shared types, the
// feature catalogue, the built-in preset library, and the pure helpers that
// summarise, validate and normalise templates. No server-only or JSX imports
// live here so it can be pulled into client components and server actions alike
// (icons are referenced by lucide name, resolved in the UI — same stance as
// lib/command-palette.ts / lib/security.ts).
//
// A template is no longer a snapshot of server config (welcome messages, rules,
// role structures). It is a **Pulsify feature profile**: a map of which app
// features are turned ON vs OFF. Applying a template flips each feature's master
// enable switch — it does NOT create roles or channels. Admins still configure
// each feature's specifics in its own settings; a template only decides what is
// switched on for the server.
//
// Each feature key maps to where its master "enabled" flag lives (the apply path
// in the route's actions.ts owns the writes):
//   • automations       → guild_settings.settings { welcome.enabled, goodbye.enabled }
//   • onboarding        → guild_settings.settings.member_onboarding.enabled
//   • moderation_alerts → guild_settings.settings.moderation_alerts.enabled
//   • pulse_guard       → ai_moderation_settings.enabled
//   • ddos_protection   → security_configs.enabled
//   • tickets           → ticket_configs.enabled
//   • private_channels  → private_channel_configs.enabled
//   • leveling          → leveling_settings.enabled
//   • economy           → economy_reward_settings.enabled

// ── Features ─────────────────────────────────────────────────────────────────

export const FEATURE_KEYS = [
  'automations',
  'onboarding',
  'moderation_alerts',
  'pulse_guard',
  'ddos_protection',
  'tickets',
  'private_channels',
  'leveling',
  'economy',
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

export type FeaturePlan = 'free' | 'pro' | 'business'

export type FeatureMeta = {
  label: string
  /** One-line "what this turns on". */
  description: string
  icon: string
  accent: string
  /** Minimum plan — surfaced as a small badge; informational only. */
  plan: FeaturePlan
  /** Where the admin configures the feature's specifics (relative to the guild). */
  settingsPath: string
  /** Short group label for organising the toggle list. */
  group: 'engagement' | 'safety' | 'experience'
}

export const FEATURE_META: Record<FeatureKey, FeatureMeta> = {
  automations: {
    label: 'Welcome & Automations',
    description: 'Greet new members and send goodbye messages automatically.',
    icon: 'Zap',
    accent: '#f59e0b',
    plan: 'free',
    settingsPath: '/automations',
    group: 'experience',
  },
  onboarding: {
    label: 'Onboarding',
    description: 'An interactive welcome & onboarding panel for new members.',
    icon: 'Compass',
    accent: '#22d3ee',
    plan: 'free',
    settingsPath: '/onboarding',
    group: 'experience',
  },
  moderation_alerts: {
    label: 'Moderation Alerts',
    description: 'Route moderation actions to a staff alert channel.',
    icon: 'Shield',
    accent: '#f87171',
    plan: 'free',
    settingsPath: '/moderation',
    group: 'safety',
  },
  pulse_guard: {
    label: 'Pulse Guard',
    description: 'AI moderation for spam, scams, phishing and toxicity.',
    icon: 'ShieldAlert',
    accent: '#ef4444',
    plan: 'pro',
    settingsPath: '/ai-moderation-settings',
    group: 'safety',
  },
  ddos_protection: {
    label: 'DDoS Protection',
    description: 'Detect and mitigate traffic spikes, abuse and raids.',
    icon: 'Siren',
    accent: '#ef4444',
    plan: 'pro',
    settingsPath: '/security-settings',
    group: 'safety',
  },
  tickets: {
    label: 'Tickets',
    description: 'A support ticket panel with types, limits and auto-close.',
    icon: 'LifeBuoy',
    accent: '#34d399',
    plan: 'free',
    settingsPath: '/ticket-settings',
    group: 'experience',
  },
  private_channels: {
    label: 'Private Channels',
    description: 'Join-to-create temporary voice channels for members.',
    icon: 'Mic2',
    accent: '#60a5fa',
    plan: 'free',
    settingsPath: '/private-channels-settings',
    group: 'experience',
  },
  leveling: {
    label: 'Levels & XP',
    description: 'Reward activity with XP, levels and a leaderboard.',
    icon: 'Trophy',
    accent: '#fbbf24',
    plan: 'free',
    settingsPath: '/leveling-settings',
    group: 'engagement',
  },
  economy: {
    label: 'Economy',
    description: 'Let members earn Pulse Coins from activity.',
    icon: 'Coins',
    accent: '#34d399',
    plan: 'free',
    settingsPath: '/economy-earning',
    group: 'engagement',
  },
}

export const FEATURE_GROUP_META: Record<
  FeatureMeta['group'],
  { label: string; icon: string }
> = {
  experience: { label: 'Member experience', icon: 'Sparkles' },
  engagement: { label: 'Engagement', icon: 'Trophy' },
  safety: { label: 'Safety & security', icon: 'ShieldCheck' },
}

/** A template's payload: which features it wants ON vs OFF. A feature absent from
 *  the map is left untouched on apply (so partial profiles are possible). */
export type FeatureMap = Partial<Record<FeatureKey, boolean>>

export function normaliseFeatureMap(raw: unknown): FeatureMap {
  const out: FeatureMap = {}
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  for (const key of FEATURE_KEYS) {
    if (typeof r[key] === 'boolean') out[key] = r[key] as boolean
  }
  return out
}

/** Feature keys this template explicitly turns ON. */
export function featureKeysEnabled(map: FeatureMap): FeatureKey[] {
  return FEATURE_KEYS.filter((k) => map[k] === true)
}

/** Feature keys the template makes a decision about (on OR off). */
export function featureKeysDecided(map: FeatureMap): FeatureKey[] {
  return FEATURE_KEYS.filter((k) => typeof map[k] === 'boolean')
}

export function enabledFeatureCount(map: FeatureMap): number {
  return featureKeysEnabled(map).length
}

// ── Categories ───────────────────────────────────────────────────────────────

export const TEMPLATE_CATEGORIES = [
  'gaming',
  'creator',
  'support',
  'startup',
  'community',
  'custom',
] as const

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

export const CATEGORY_META: Record<
  TemplateCategory,
  { label: string; description: string; icon: string; accent: string }
> = {
  gaming: { label: 'Gaming', description: 'Clans, squads and game nights.', icon: 'Gamepad2', accent: '#22d3ee' },
  creator: { label: 'Creator', description: 'Streamers, artists and their audience.', icon: 'Sparkles', accent: '#ec4899' },
  support: { label: 'Support', description: 'Product help desks and ticket-first servers.', icon: 'LifeBuoy', accent: '#34d399' },
  startup: { label: 'Startup', description: 'Early adopters, feedback and announcements.', icon: 'Rocket', accent: '#f59e0b' },
  community: { label: 'Community', description: 'High-traffic public servers that need strong safety.', icon: 'Users', accent: '#8b5cf6' },
  custom: { label: 'Custom', description: 'Saved from one of your servers.', icon: 'LayoutTemplate', accent: 'var(--text-2)' },
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export type ServerTemplate = {
  id: string
  guildId: string | null
  name: string
  description: string | null
  category: TemplateCategory
  icon: string
  features: FeatureMap
  authorId: string | null
  authorName: string | null
  usageCount: number
  createdAt: string
  updatedAt: string
  /** True for the in-code official presets (not persisted in the DB). */
  builtin: boolean
}

/** What the create panel collects. */
export type TemplateDraft = {
  name: string
  description: string
  category: TemplateCategory
  icon: string
  features: FeatureMap
}

export const TEMPLATE_LIMITS = {
  nameMax: 60,
  descriptionMax: 280,
} as const

/** Bumped if the export envelope shape changes — import checks compatibility. */
export const TEMPLATE_EXPORT_VERSION = 2

// ── Normalisation ────────────────────────────────────────────────────────────

function asCategory(v: unknown): TemplateCategory {
  return TEMPLATE_CATEGORIES.includes(v as TemplateCategory) ? (v as TemplateCategory) : 'custom'
}

/** Coerce a DB row into a ServerTemplate. Reads the new `features` column and
 *  falls back to an empty map for legacy rows that only had `sections`. */
export function normaliseTemplate(row: Record<string, unknown>): ServerTemplate {
  return {
    id: String(row.id),
    guildId: (row.guild_id as string | null) ?? null,
    name: String(row.name ?? 'Untitled template'),
    description: (row.description as string | null) ?? null,
    category: asCategory(row.category),
    icon: String(row.icon ?? 'LayoutTemplate'),
    features: normaliseFeatureMap(row.features),
    authorId: (row.author_id as string | null) ?? null,
    authorName: (row.author_name as string | null) ?? null,
    usageCount: Number(row.usage_count ?? 0),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    builtin: false,
  }
}

// ── Import / export ──────────────────────────────────────────────────────────

export type TemplateExport = {
  pulsifyTemplate: typeof TEMPLATE_EXPORT_VERSION
  name: string
  description: string | null
  category: TemplateCategory
  icon: string
  features: FeatureMap
  exportedAt: string
}

export function toExport(t: ServerTemplate): TemplateExport {
  return {
    pulsifyTemplate: TEMPLATE_EXPORT_VERSION,
    name: t.name,
    description: t.description,
    category: t.category,
    icon: t.icon,
    features: t.features,
    exportedAt: new Date().toISOString(),
  }
}

export type ImportResult =
  | { ok: true; value: { name: string; description: string | null; category: TemplateCategory; icon: string; features: FeatureMap }; warnings: string[] }
  | { ok: false; error: string }

/** Validate a parsed JSON object as an importable template. Tolerant of a bare
 *  `features` object (no envelope) and of unknown future minor additions. */
export function validateTemplateImport(input: unknown): ImportResult {
  if (input == null || typeof input !== 'object') {
    return { ok: false, error: 'File is not a JSON object.' }
  }
  const obj = input as Record<string, unknown>
  const warnings: string[] = []

  const version = obj.pulsifyTemplate
  if (version != null && Number(version) > TEMPLATE_EXPORT_VERSION) {
    warnings.push('This file was exported by a newer version of Pulsify — some settings may be ignored.')
  }
  if (version != null && Number(version) < TEMPLATE_EXPORT_VERSION) {
    warnings.push('This file is from an older template format — only feature toggles were imported.')
  }

  const features = normaliseFeatureMap(obj.features ?? obj)
  if (featureKeysDecided(features).length === 0) {
    return { ok: false, error: 'No recognisable feature settings found in this file.' }
  }

  const name =
    typeof obj.name === 'string' && obj.name.trim()
      ? obj.name.trim().slice(0, TEMPLATE_LIMITS.nameMax)
      : 'Imported template'
  const description =
    typeof obj.description === 'string' ? obj.description.slice(0, TEMPLATE_LIMITS.descriptionMax) : null
  const category = asCategory(obj.category)
  const icon = typeof obj.icon === 'string' ? obj.icon : CATEGORY_META[category].icon

  return { ok: true, value: { name, description, category, icon, features }, warnings }
}

// ── Draft validation ─────────────────────────────────────────────────────────

export function validateDraft(draft: TemplateDraft): string | null {
  if (!draft.name.trim()) return 'Give the template a name.'
  if (draft.name.length > TEMPLATE_LIMITS.nameMax)
    return `Name must be ${TEMPLATE_LIMITS.nameMax} characters or fewer.`
  if (draft.description.length > TEMPLATE_LIMITS.descriptionMax)
    return `Description must be ${TEMPLATE_LIMITS.descriptionMax} characters or fewer.`
  if (featureKeysDecided(draft.features).length === 0) return 'Choose what this template turns on or off.'
  return null
}

// ── Built-in presets ─────────────────────────────────────────────────────────
// Official, in-code feature profiles that ship with the app. Each defines a full
// on/off decision for every feature, so applying one configures the whole app at
// once. Admins fine-tune the specifics in each feature afterwards.

/** Build a full feature map from the list of features to ENABLE (rest off). */
function profile(on: FeatureKey[]): FeatureMap {
  const map: FeatureMap = {}
  for (const k of FEATURE_KEYS) map[k] = on.includes(k)
  return map
}

type Preset = Omit<ServerTemplate, 'createdAt' | 'updatedAt' | 'usageCount'> & { usageCount?: number }

const PRESETS: Preset[] = [
  {
    id: 'builtin-essentials',
    guildId: null,
    name: 'Essentials',
    description: 'A safe starting point — welcome new members, onboard them, and keep the server protected. Engagement extras stay off until you want them.',
    category: 'custom',
    icon: 'Rocket',
    authorId: null,
    authorName: 'Pulsify',
    builtin: true,
    features: profile(['automations', 'onboarding', 'moderation_alerts', 'pulse_guard']),
  },
  {
    id: 'builtin-community',
    guildId: null,
    name: 'Full Community',
    description: 'Everything switched on — welcome, onboarding, engagement (levels & economy), tickets, private channels and the full safety stack.',
    category: 'community',
    icon: 'Users',
    authorId: null,
    authorName: 'Pulsify',
    builtin: true,
    features: profile([...FEATURE_KEYS]),
  },
  {
    id: 'builtin-gaming',
    guildId: null,
    name: 'Gaming Community',
    description: 'Engagement-forward: levels, economy, welcome and private voice channels for squads — with Pulse Guard keeping banter in check.',
    category: 'gaming',
    icon: 'Gamepad2',
    authorId: null,
    authorName: 'Pulsify',
    builtin: true,
    features: profile(['automations', 'onboarding', 'leveling', 'economy', 'private_channels', 'pulse_guard', 'moderation_alerts']),
  },
  {
    id: 'builtin-creator',
    guildId: null,
    name: 'Creator Community',
    description: 'For streamers and artists: a warm welcome, onboarding, levels and economy to reward supporters, plus core safety.',
    category: 'creator',
    icon: 'Sparkles',
    authorId: null,
    authorName: 'Pulsify',
    builtin: true,
    features: profile(['automations', 'onboarding', 'leveling', 'economy', 'pulse_guard', 'moderation_alerts']),
  },
  {
    id: 'builtin-support',
    guildId: null,
    name: 'Support Server',
    description: 'A ticket-first help desk: tickets, moderation alerts and Pulse Guard on; engagement features off to keep it focused.',
    category: 'support',
    icon: 'LifeBuoy',
    authorId: null,
    authorName: 'Pulsify',
    builtin: true,
    features: profile(['automations', 'onboarding', 'tickets', 'moderation_alerts', 'pulse_guard']),
  },
  {
    id: 'builtin-public',
    guildId: null,
    name: 'Public / High-traffic',
    description: 'Lock it down for scale: the full safety stack (Pulse Guard + DDoS Protection + moderation alerts) plus tickets, onboarding and welcome.',
    category: 'community',
    icon: 'ShieldCheck',
    authorId: null,
    authorName: 'Pulsify',
    builtin: true,
    features: profile(['automations', 'onboarding', 'moderation_alerts', 'pulse_guard', 'ddos_protection', 'tickets']),
  },
]

/** The official preset library, presented as ServerTemplates with stable
 *  timestamps so list ordering is deterministic. */
export const BUILTIN_TEMPLATES: ServerTemplate[] = PRESETS.map((p) => ({
  ...p,
  usageCount: p.usageCount ?? 0,
  createdAt: '2026-06-19T00:00:00.000Z',
  updatedAt: '2026-06-19T00:00:00.000Z',
}))

export function findBuiltin(id: string): ServerTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id)
}
