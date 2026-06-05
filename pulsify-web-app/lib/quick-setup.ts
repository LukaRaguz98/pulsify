// Quick Setup (server overview) — turns a few high-level preferences into a
// ready-to-use server template. It reuses the official preset library
// (lib/templates.ts) as a source of sensible per-section defaults, then narrows
// it to the features the admin actually wants. Pure & JSX-free (icons are
// referenced by lucide name, resolved in the UI — same stance as lib/templates.ts)
// so it can be imported by both the client wizard and the server action.

import {
  BUILTIN_TEMPLATES,
  sectionKeysPresent,
  type TemplateCategory,
  type TemplateSectionKey,
  type TemplateSections,
} from './templates'

export type GuardSensitivity = 'low' | 'medium' | 'aggressive'

/** A starting point for the wizard — the kind of community being set up. Each
 *  archetype seeds its defaults from one of the built-in presets. */
export type QuickSetupArchetype = {
  id: string
  label: string
  description: string
  icon: string
  accent: string
  /** Category stored on the generated template. */
  category: TemplateCategory
  /** Built-in preset whose section defaults seed this archetype. */
  presetId: string
}

export const QUICK_SETUP_ARCHETYPES: QuickSetupArchetype[] = [
  {
    id: 'gaming',
    label: 'Gaming community',
    description: 'Squads, LFG roles and banter-friendly moderation.',
    icon: 'Gamepad2',
    accent: '#22d3ee',
    category: 'gaming',
    presetId: 'builtin-gaming',
  },
  {
    id: 'creator',
    label: 'Creator community',
    description: 'Supporter tiers and an announcement-ready home.',
    icon: 'Sparkles',
    accent: '#ec4899',
    category: 'creator',
    presetId: 'builtin-creator',
  },
  {
    id: 'support',
    label: 'Support server',
    description: 'A ticket-first help desk with staff roles.',
    icon: 'LifeBuoy',
    accent: '#34d399',
    category: 'support',
    presetId: 'builtin-support',
  },
  {
    id: 'startup',
    label: 'Startup / product',
    description: 'Feedback channels, beta roles and announcements.',
    icon: 'Rocket',
    accent: '#f59e0b',
    category: 'startup',
    presetId: 'builtin-startup',
  },
  {
    id: 'community',
    label: 'Large community',
    description: 'Strong safety, a full role hierarchy and tickets.',
    icon: 'Users',
    accent: '#8b5cf6',
    category: 'community',
    presetId: 'builtin-community',
  },
  {
    id: 'education',
    label: 'Study / education',
    description: 'Subject roles, study halls and a tutor help desk.',
    icon: 'GraduationCap',
    accent: '#60a5fa',
    category: 'community',
    presetId: 'builtin-education',
  },
]

export function findArchetype(id: string): QuickSetupArchetype | undefined {
  return QUICK_SETUP_ARCHETYPES.find((a) => a.id === id)
}

function presetFor(presetId: string) {
  return BUILTIN_TEMPLATES.find((t) => t.id === presetId)
}

/** Sections an archetype can configure (those its source preset actually carries). */
export function archetypeSectionKeys(id: string): TemplateSectionKey[] {
  const preset = presetFor(findArchetype(id)?.presetId ?? '')
  return preset ? sectionKeysPresent(preset.sections) : []
}

/** The preset's own moderation strictness, used to seed the toggle. */
export function archetypeDefaultSensitivity(id: string): GuardSensitivity {
  const s = presetFor(findArchetype(id)?.presetId ?? '')?.sections.pulse_guard?.sensitivity
  return s === 'low' || s === 'aggressive' ? s : 'medium'
}

export const GUARD_SENSITIVITY_OPTIONS: {
  id: GuardSensitivity
  label: string
  description: string
}[] = [
  { id: 'low', label: 'Relaxed', description: 'Only the clearest violations are actioned.' },
  { id: 'medium', label: 'Balanced', description: 'A sensible default for most servers.' },
  { id: 'aggressive', label: 'Strict', description: 'Catches more, with a higher chance of false positives.' },
]

export type QuickSetupAnswers = {
  archetypeId: string
  sectionKeys: TemplateSectionKey[]
  guardSensitivity: GuardSensitivity
  name: string
  description: string
}

export type QuickSetupResult = {
  name: string
  description: string
  category: TemplateCategory
  icon: string
  sections: TemplateSections
}

/** Build the template payload from the collected answers. Returns null if the
 *  archetype is unknown or nothing was selected to set up. */
export function buildQuickSetup(answers: QuickSetupAnswers): QuickSetupResult | null {
  const arch = findArchetype(answers.archetypeId)
  const preset = arch && presetFor(arch.presetId)
  if (!arch || !preset) return null

  const available = sectionKeysPresent(preset.sections)
  const chosen = answers.sectionKeys.filter((k) => available.includes(k))
  if (chosen.length === 0) return null

  // Clone so wizard tweaks never mutate the shared preset objects.
  const src = JSON.parse(JSON.stringify(preset.sections)) as TemplateSections
  const sections: TemplateSections = {}
  for (const key of chosen) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(sections as any)[key] = (src as any)[key]
  }

  // Apply the strictness preference to Pulse Guard if it's part of the setup.
  if (sections.pulse_guard) {
    sections.pulse_guard.sensitivity = answers.guardSensitivity
    if (sections.pulse_guard.settings) {
      ;(sections.pulse_guard.settings as Record<string, unknown>).sensitivity =
        answers.guardSensitivity
    }
  }

  const name = answers.name.trim() || `${arch.label} setup`
  const description =
    answers.description.trim() ||
    `Quick-setup configuration for a ${arch.label.toLowerCase()}.`

  return { name, description, category: arch.category, icon: arch.icon, sections }
}
