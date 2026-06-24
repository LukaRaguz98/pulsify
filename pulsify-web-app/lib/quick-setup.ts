// Quick Setup — turns a chosen preset (+ optional per-feature tweaks) into a
// saved, editable feature profile that can be applied to the server in one go.
// It reuses the official preset library (lib/templates.ts) as starting points.
// Pure & JSX-free (icons by lucide name, resolved in the UI) so it can be shared
// by the client wizard and the server action.

import {
  BUILTIN_TEMPLATES,
  featureKeysDecided,
  normaliseFeatureMap,
  type FeatureMap,
  type ServerTemplate,
  type TemplateCategory,
} from './templates'

/** The official presets, used as the quick-setup starting points. */
export const QUICK_SETUP_PRESETS: ServerTemplate[] = BUILTIN_TEMPLATES

export function findQuickSetupPreset(id: string): ServerTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id)
}

export type QuickSetupAnswers = {
  presetId: string
  /** The (possibly tweaked) feature on/off map to save + apply. */
  features: FeatureMap
  name: string
}

export type QuickSetupResult = {
  name: string
  description: string
  category: TemplateCategory
  icon: string
  features: FeatureMap
}

/** Build the template payload from the collected answers. Returns null if the
 *  preset is unknown or no feature decision was made. */
export function buildQuickSetup(answers: QuickSetupAnswers): QuickSetupResult | null {
  const preset = findQuickSetupPreset(answers.presetId)
  if (!preset) return null

  const features = normaliseFeatureMap(answers.features)
  if (featureKeysDecided(features).length === 0) return null

  const name = answers.name.trim() || `${preset.name} setup`
  const description = `Feature profile based on the ${preset.name} preset.`

  return { name, description, category: preset.category, icon: preset.icon, features }
}
