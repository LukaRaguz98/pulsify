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
