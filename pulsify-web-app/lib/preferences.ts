import type { ThemeId } from './themes'

export type { ThemeId }
export type ColorScheme = 'dark' | 'light'
export type LayoutDensity = 'comfortable' | 'compact'
export type FontSize = 'small' | 'medium' | 'large'

export interface UserPreferences {
  theme: ThemeId
  scheme: ColorScheme
  density: LayoutDensity
  animations: boolean
  cornerDeco: boolean
  /** Hex accent color (e.g. "#8b5cf6") that overrides the preset theme's
   *  `--p-1` and derived vars. `null` means "use the preset theme as-is". */
  themeCustomColor: string | null
  /** Scales the root font-size; rem-based UI scales with it. */
  fontSize: FontSize
  /** Whether the radial-gradient ambient glow in `body::before` is visible. */
  ambientGlow: boolean
  /** Whether the live Discord-latency chip in the bottom-right corner shows. */
  pingIndicator: boolean
  /** Whether the contextual help icons (ⓘ) and their tooltips are shown.
   *  Experienced users can switch these off globally. */
  contextualHelp: boolean
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'violet',
  scheme: 'dark',
  density: 'comfortable',
  animations: true,
  cornerDeco: false,
  themeCustomColor: null,
  fontSize: 'medium',
  ambientGlow: true,
  pingIndicator: true,
  contextualHelp: true,
}

export const PREF_COOKIES = {
  theme: 'pulsify-theme',
  scheme: 'pulsify-scheme',
  density: 'pulsify-density',
  animations: 'pulsify-animations',
  cornerDeco: 'pulsify-corner-deco',
  themeCustomColor: 'pulsify-theme-custom-color',
  fontSize: 'pulsify-font-size',
  ambientGlow: 'pulsify-ambient-glow',
  pingIndicator: 'pulsify-ping-indicator',
  contextualHelp: 'pulsify-contextual-help',
} as const
