// First-time onboarding — shared types, catalogs and recommendation logic for
// the setup wizard. Pure data/logic only (icons referenced by lucide name,
// resolved in the UI layer, like lib/automations.ts) so it stays testable and
// usable from both the wizard and the server actions.

import type { ThemeId } from '@/lib/themes'
import type { LayoutDensity } from '@/lib/preferences'

export type ModSensitivity = 'low' | 'medium' | 'aggressive'

export type OnboardingStatus = 'in_progress' | 'completed' | 'skipped'

export type FeatureKey = 'welcome' | 'auto_role' | 'moderation' | 'pulse_guard' | 'analytics'

/** Personalization choices that tailor the recommended setup. */
export type OnboardingSelections = {
  serverType?: string
  modIntensity?: string
  layout?: LayoutDensity
  theme?: ThemeId
}

/** Persisted in guild_settings.settings.onboarding_state. */
export type OnboardingState = {
  status: OnboardingStatus
  /** Step index the user last reached (for resume). */
  step: number
  selections: OnboardingSelections
  /** Feature keys actually applied on completion. */
  appliedFeatures: FeatureKey[]
  startedAt?: string
  updatedAt?: string
  completedAt?: string
}

export const EMPTY_ONBOARDING_STATE: OnboardingState = {
  status: 'in_progress',
  step: 0,
  selections: {},
  appliedFeatures: [],
}

// ── Steps ─────────────────────────────────────────────────────────────────────

export const ONBOARDING_STEPS = [
  { id: 'personalize', title: 'Personalize', icon: 'Sparkles' },
  { id: 'connect', title: 'Connect', icon: 'Plug' },
  { id: 'features', title: 'Features', icon: 'Zap' },
  { id: 'review', title: 'Review', icon: 'CheckCircle2' },
] as const

export const STEP_COUNT = ONBOARDING_STEPS.length

// ── Personalization catalogs ────────────────────────────────────────────────

export type Choice = { id: string; label: string; desc: string; icon: string }

export const SERVER_TYPES: Choice[] = [
  { id: 'gaming', label: 'Gaming', desc: 'Game nights, LFG, clips', icon: 'Gamepad2' },
  { id: 'community', label: 'Community', desc: 'Hobbies, interests, hangouts', icon: 'Users' },
  { id: 'creator', label: 'Creator', desc: 'Fans, content, announcements', icon: 'Sparkles' },
  { id: 'education', label: 'Education', desc: 'Study groups, courses, Q&A', icon: 'GraduationCap' },
  { id: 'business', label: 'Business', desc: 'Team, support, professional', icon: 'Briefcase' },
  { id: 'other', label: 'Other', desc: 'Something else entirely', icon: 'Globe' },
]

export type IntensityChoice = Choice & { sensitivity: ModSensitivity }

export const MOD_INTENSITIES: IntensityChoice[] = [
  { id: 'relaxed', label: 'Relaxed', desc: 'Light touch — flag, don’t act', icon: 'Feather', sensitivity: 'low' },
  { id: 'balanced', label: 'Balanced', desc: 'Recommended for most servers', icon: 'Scale', sensitivity: 'medium' },
  { id: 'strict', label: 'Strict', desc: 'Zero tolerance — auto-act', icon: 'ShieldAlert', sensitivity: 'aggressive' },
]

export const LAYOUT_OPTIONS: { id: LayoutDensity; label: string; desc: string; icon: string }[] = [
  { id: 'comfortable', label: 'Comfortable', desc: 'Roomy, spacious spacing', icon: 'LayoutGrid' },
  { id: 'compact', label: 'Compact', desc: 'Denser — more on screen', icon: 'LayoutList' },
]

// ── Feature templates ─────────────────────────────────────────────────────────

export type FeatureNeeds = 'channel' | 'role' | 'sensitivity' | 'none'

export type FeatureTemplate = {
  key: FeatureKey
  label: string
  desc: string
  icon: string
  accent: string
  needs: FeatureNeeds
}

export const FEATURE_TEMPLATES: FeatureTemplate[] = [
  { key: 'welcome', label: 'Welcome system', desc: 'Greet every new member automatically.', icon: 'Hand', accent: 'var(--p-1)', needs: 'channel' },
  { key: 'auto_role', label: 'Auto roles', desc: 'Assign a role the moment someone joins.', icon: 'UserPlus', accent: '#22d3ee', needs: 'role' },
  { key: 'moderation', label: 'Moderation alerts', desc: 'Post every mod action to a log channel.', icon: 'Shield', accent: '#f59e0b', needs: 'channel' },
  { key: 'pulse_guard', label: 'Pulse Guard', desc: 'AI moderation for spam, scams & toxicity.', icon: 'ShieldAlert', accent: '#f87171', needs: 'sensitivity' },
  { key: 'analytics', label: 'Analytics', desc: 'Live member & message insights — always on.', icon: 'BarChart3', accent: '#10b981', needs: 'none' },
]

export const FEATURE_BY_KEY: Record<FeatureKey, FeatureTemplate> = Object.fromEntries(
  FEATURE_TEMPLATES.map((f) => [f.key, f]),
) as Record<FeatureKey, FeatureTemplate>

// ── Recommendation logic ────────────────────────────────────────────────────

export function sensitivityForIntensity(intensity: string | undefined): ModSensitivity {
  return MOD_INTENSITIES.find((m) => m.id === intensity)?.sensitivity ?? 'medium'
}

/** A welcome message whose tone matches the chosen server type. */
export function welcomeMessageFor(serverType: string | undefined): string {
  switch (serverType) {
    case 'gaming':
      return 'GG and welcome to {server}, {user}! 🎮 Grab your roles and jump in.'
    case 'creator':
      return 'Welcome to {server}, {user}! ✨ Thanks for joining — check the latest updates.'
    case 'education':
      return 'Welcome to {server}, {user}! 📚 Introduce yourself and dive into the channels.'
    case 'business':
      return 'Welcome to {server}, {user}. Glad to have you — see the getting-started channel.'
    case 'community':
      return 'Welcome to {server}, {user}! 👋 So glad you’re here — make yourself at home.'
    default:
      return 'Welcome to {server}, {user}! 👋 Glad to have you here.'
  }
}

/**
 * Which feature templates to pre-select, based on the user's personalization.
 * Strict/balanced moderation recommends Pulse Guard; relaxed leaves it opt-in.
 */
export function recommendedFeatures(selections: OnboardingSelections): Record<FeatureKey, boolean> {
  const intensity = selections.modIntensity
  return {
    welcome: true,
    auto_role: true,
    moderation: true,
    pulse_guard: intensity !== 'relaxed',
    analytics: true,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Member-facing Onboarding & Welcome (PULSIFY-37)
//
// The upgraded, member-facing onboarding experience. The dashboard configures
// it; the bot (pulse-bot/src/onboarding.js) delivers an interactive panel to new
// members. Config persists in guild_settings.settings.member_onboarding; the
// shapes below are mirrored verbatim by the bot module. Per-member progress and
// analytics live in onboarding_member_progress (20260607_member_onboarding.sql).
// ════════════════════════════════════════════════════════════════════════════

/** Reorderable steps of the onboarding journey. `welcome` is always first. */
export type OnboardingStepId =
  | 'welcome'
  | 'verification'
  | 'roles'
  | 'events'
  | 'community'
  | 'rewards'

export type OnboardingStepConfig = { id: OnboardingStepId; enabled: boolean }

export const ONBOARDING_STEP_META: Record<
  OnboardingStepId,
  { label: string; desc: string; icon: string; locked?: boolean }
> = {
  welcome:      { label: 'Welcome',      desc: 'The greeting embed shown first.',                icon: 'Hand', locked: true },
  verification: { label: 'Verification', desc: 'Guide members through verifying access.',         icon: 'ShieldCheck' },
  roles:        { label: 'Self-roles',   desc: 'Let members pick roles by category.',            icon: 'Tags' },
  events:       { label: 'Events',       desc: 'Showcase upcoming server events.',               icon: 'CalendarDays' },
  community:    { label: 'Community',    desc: 'Highlight key channels & guidelines.',           icon: 'Compass' },
  rewards:      { label: 'Rewards',      desc: 'Celebrate completion with XP & roles.',          icon: 'Gift' },
}

/** Canonical step order used for new configs (and to backfill missing steps). */
export const DEFAULT_STEP_ORDER: OnboardingStepConfig[] = [
  { id: 'welcome', enabled: true },
  { id: 'verification', enabled: false },
  { id: 'roles', enabled: true },
  { id: 'events', enabled: false },
  { id: 'community', enabled: true },
  { id: 'rewards', enabled: true },
]

// ── Self-assignable role categories ─────────────────────────────────────────

export type RoleCategoryId =
  | 'notifications'
  | 'interests'
  | 'languages'
  | 'platform_updates'
  | 'community_access'

export const ROLE_CATEGORY_META: Record<
  RoleCategoryId,
  { label: string; desc: string; icon: string; emoji: string }
> = {
  notifications:    { label: 'Notifications',    desc: 'Ping preferences & announcement opt-ins.', icon: 'Bell',      emoji: '🔔' },
  interests:        { label: 'Interests',        desc: 'Hobbies, games & topics members care about.', icon: 'Heart',  emoji: '🎯' },
  languages:        { label: 'Languages',        desc: 'Preferred languages for channels & matching.', icon: 'Languages', emoji: '🌐' },
  platform_updates: { label: 'Platform Updates', desc: 'Opt in to product / release update pings.', icon: 'Rss',     emoji: '📦' },
  community_access:  { label: 'Community Access',  desc: 'Unlock sections of the server.',           icon: 'DoorOpen', emoji: '🚪' },
}

export const ROLE_CATEGORY_ORDER: RoleCategoryId[] = [
  'notifications', 'interests', 'languages', 'platform_updates', 'community_access',
]

export type OnboardingRole = {
  role_id: string
  label: string
  description?: string
  emoji?: string
}

export type RoleCategory = {
  /** Stable client-generated id (used for React keys + select-menu custom ids). */
  id: string
  category: RoleCategoryId
  label: string
  description?: string
  /** 0 = no minimum. */
  min_select: number
  /** 0 = unlimited (capped at the role count). */
  max_select: number
  roles: OnboardingRole[]
}

// ── Welcome embed ───────────────────────────────────────────────────────────

export type WelcomeButton = { label: string; url: string; emoji?: string }
export type WelcomeQuickLink = { label: string; channel_id: string }
export type ThumbnailMode = 'member_avatar' | 'guild_icon' | 'none'

export type WelcomeEmbedConfig = {
  title: string
  description: string
  color: string
  /** Render the generated server banner image as a full-width header. */
  banner: boolean
  thumbnail: ThumbnailMode
  footer_text: string
  buttons: WelcomeButton[]
  quick_links: WelcomeQuickLink[]
}

// ── Community link highlights ───────────────────────────────────────────────

export type CommunityLinkKey =
  | 'guidelines'
  | 'support'
  | 'feedback'
  | 'feature_requests'
  | 'announcements'
  | 'release_notes'

export const COMMUNITY_LINK_META: Record<
  CommunityLinkKey,
  { label: string; desc: string; icon: string; emoji: string }
> = {
  guidelines:       { label: 'Community Guidelines', desc: 'Rules & code of conduct.',          icon: 'BookOpen',     emoji: '📜' },
  support:          { label: 'Support',              desc: 'Where to get help.',                icon: 'LifeBuoy',     emoji: '🛟' },
  feedback:         { label: 'Feedback',             desc: 'Share thoughts & ideas.',           icon: 'MessageSquare', emoji: '💬' },
  feature_requests: { label: 'Feature Requests',     desc: 'Suggest new features.',             icon: 'Lightbulb',    emoji: '💡' },
  announcements:    { label: 'Announcements',        desc: 'Important server updates.',         icon: 'Megaphone',    emoji: '📣' },
  release_notes:    { label: 'Release Notes',        desc: 'What’s new in the bot.',       icon: 'Sparkles',     emoji: '✨' },
}

export const COMMUNITY_LINK_ORDER: CommunityLinkKey[] = [
  'guidelines', 'support', 'feedback', 'feature_requests', 'announcements', 'release_notes',
]

export type CommunityLinks = Partial<Record<CommunityLinkKey, string>>

// ── Verification, events & rewards ──────────────────────────────────────────

export type VerificationConfig = {
  enabled: boolean
  role_id: string
  button_label: string
  success_message: string
}

export type EventsConfig = {
  enabled: boolean
  /** Auto-list upcoming scheduled events (vs. only the featured ids). */
  show_upcoming: boolean
  featured: string[]
  /** Max events to display in the panel. */
  max: number
}

export type RewardsConfig = {
  enabled: boolean
  xp: number
  role_ids: string[]
  reputation: number
}

export type OnboardingDelivery = 'channel' | 'dm'

export type MemberOnboardingConfig = {
  enabled: boolean
  delivery: OnboardingDelivery
  /** Channel the welcome + panel posts to (delivery = 'channel'). */
  channel_id: string
  /** Require an explicit "Finish" click before rewards fire (vs. auto-complete). */
  completion_required: boolean
  steps: OnboardingStepConfig[]
  welcome: WelcomeEmbedConfig
  roleCategories: RoleCategory[]
  events: EventsConfig
  community: CommunityLinks
  verification: VerificationConfig
  rewards: RewardsConfig
}

export const DEFAULT_WELCOME_EMBED: WelcomeEmbedConfig = {
  title: 'Welcome to {server}!',
  description: 'Hey {user}, glad to have you here! 👋\n\nTake a moment to set yourself up below — grab your roles, check out what’s happening, and find your way around.',
  color: '#6366f1',
  banner: true,
  thumbnail: 'member_avatar',
  footer_text: '',
  buttons: [],
  quick_links: [],
}

export const DEFAULT_MEMBER_ONBOARDING: MemberOnboardingConfig = {
  enabled: false,
  delivery: 'channel',
  channel_id: '',
  completion_required: true,
  steps: DEFAULT_STEP_ORDER.map((s) => ({ ...s })),
  welcome: DEFAULT_WELCOME_EMBED,
  roleCategories: [],
  events: { enabled: false, show_upcoming: true, featured: [], max: 3 },
  community: {},
  verification: {
    enabled: false,
    role_id: '',
    button_label: 'Verify me',
    success_message: 'You’re verified — welcome aboard! ✅',
  },
  rewards: { enabled: true, xp: 100, role_ids: [], reputation: 5 },
}

/**
 * Merge a stored (possibly partial / legacy) config with the defaults so the
 * editor and the bot always see a complete, well-typed object. Backfills any
 * step ids added in later versions while preserving the saved order.
 */
export function normalizeMemberOnboarding(
  raw: Partial<MemberOnboardingConfig> | undefined | null,
): MemberOnboardingConfig {
  const base = DEFAULT_MEMBER_ONBOARDING
  if (!raw) return { ...base, steps: base.steps.map((s) => ({ ...s })) }

  // Steps: keep saved order, drop unknown ids, append any missing known ids.
  const savedSteps = Array.isArray(raw.steps) ? raw.steps : []
  const known = new Set<OnboardingStepId>(DEFAULT_STEP_ORDER.map((s) => s.id))
  const seen = new Set<OnboardingStepId>()
  const steps: OnboardingStepConfig[] = []
  for (const s of savedSteps) {
    if (s && known.has(s.id) && !seen.has(s.id)) {
      seen.add(s.id)
      steps.push({ id: s.id, enabled: s.id === 'welcome' ? true : !!s.enabled })
    }
  }
  for (const d of DEFAULT_STEP_ORDER) {
    if (!seen.has(d.id)) steps.push({ ...d })
  }

  return {
    enabled: !!raw.enabled,
    delivery: raw.delivery === 'dm' ? 'dm' : 'channel',
    channel_id: raw.channel_id ?? '',
    completion_required: raw.completion_required ?? base.completion_required,
    steps,
    welcome: { ...base.welcome, ...(raw.welcome ?? {}),
      buttons: raw.welcome?.buttons ?? [],
      quick_links: raw.welcome?.quick_links ?? [],
    },
    roleCategories: Array.isArray(raw.roleCategories) ? raw.roleCategories : [],
    events: { ...base.events, ...(raw.events ?? {}), featured: raw.events?.featured ?? [] },
    community: raw.community ?? {},
    verification: { ...base.verification, ...(raw.verification ?? {}) },
    rewards: { ...base.rewards, ...(raw.rewards ?? {}), role_ids: raw.rewards?.role_ids ?? [] },
  }
}

// ── Analytics (shape of get_onboarding_stats RPC) ───────────────────────────

export type OnboardingStats = {
  starts: number
  completions: number
  verified: number
  /** 0..1 */
  completion_rate: number
  roles: { role_id: string; count: number }[]
  skipped: { step_id: OnboardingStepId; count: number }[]
  series: { date: string; starts: number; completions: number }[]
}

// ── Presets ─────────────────────────────────────────────────────────────────

export type OnboardingPreset = {
  id: string
  label: string
  desc: string
  icon: string
  /** Patch applied over the current config (channels/roles stay the user's). */
  apply: (cfg: MemberOnboardingConfig) => MemberOnboardingConfig
}

function withSteps(cfg: MemberOnboardingConfig, enabled: OnboardingStepId[]): MemberOnboardingConfig {
  const on = new Set(enabled)
  return {
    ...cfg,
    steps: cfg.steps.map((s) => ({ ...s, enabled: s.id === 'welcome' ? true : on.has(s.id) })),
  }
}

export const ONBOARDING_PRESETS: OnboardingPreset[] = [
  {
    id: 'gaming',
    label: 'Gaming',
    desc: 'Roles, events & community — high energy.',
    icon: 'Gamepad2',
    apply: (cfg) => ({
      ...withSteps(cfg, ['roles', 'events', 'community', 'rewards']),
      welcome: { ...cfg.welcome,
        title: 'GG — welcome to {server}!',
        description: 'Welcome {user}! 🎮\n\nGrab your roles, check the upcoming events and jump in.',
      },
      events: { ...cfg.events, enabled: true, show_upcoming: true },
      rewards: { ...cfg.rewards, enabled: true, xp: 150 },
    }),
  },
  {
    id: 'community',
    label: 'Community',
    desc: 'Guidelines-first, welcoming & calm.',
    icon: 'Users',
    apply: (cfg) => ({
      ...withSteps(cfg, ['roles', 'community', 'rewards']),
      welcome: { ...cfg.welcome,
        title: 'Welcome to {server} 👋',
        description: 'So glad you’re here, {user}! Make yourself at home — set up your roles and read the guidelines below.',
      },
      rewards: { ...cfg.rewards, enabled: true, xp: 100, reputation: 5 },
    }),
  },
  {
    id: 'creator',
    label: 'Creator',
    desc: 'Notifications, updates & announcements.',
    icon: 'Sparkles',
    apply: (cfg) => ({
      ...withSteps(cfg, ['roles', 'community', 'rewards']),
      welcome: { ...cfg.welcome,
        title: 'Welcome to {server}! ✨',
        description: 'Thanks for joining, {user}! Pick your notification roles so you never miss an update.',
      },
      rewards: { ...cfg.rewards, enabled: true, xp: 100 },
    }),
  },
  {
    id: 'secure',
    label: 'Verified',
    desc: 'Verification gate before access.',
    icon: 'ShieldCheck',
    apply: (cfg) => ({
      ...withSteps(cfg, ['verification', 'roles', 'community', 'rewards']),
      verification: { ...cfg.verification, enabled: true },
      completion_required: true,
      welcome: { ...cfg.welcome,
        title: 'Welcome to {server}',
        description: 'Hey {user} — verify below to unlock the server, then set up your roles.',
      },
    }),
  },
]
