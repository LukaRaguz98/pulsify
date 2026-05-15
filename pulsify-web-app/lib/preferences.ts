import type { ThemeId } from './themes'

export type { ThemeId }
export type ColorScheme = 'dark' | 'light'
export type LayoutDensity = 'comfortable' | 'compact'

export interface UserPreferences {
  theme: ThemeId
  scheme: ColorScheme
  density: LayoutDensity
  animations: boolean
  cornerDeco: boolean
  /** Hex accent color (e.g. "#8b5cf6") that overrides the preset theme's
   *  `--p-1` and derived vars. `null` means "use the preset theme as-is". */
  themeCustomColor: string | null
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'violet',
  scheme: 'dark',
  density: 'comfortable',
  animations: true,
  cornerDeco: true,
  themeCustomColor: null,
}

export const PREF_COOKIES = {
  theme: 'pulsify-theme',
  scheme: 'pulsify-scheme',
  density: 'pulsify-density',
  animations: 'pulsify-animations',
  cornerDeco: 'pulsify-corner-deco',
  themeCustomColor: 'pulsify-theme-custom-color',
} as const
