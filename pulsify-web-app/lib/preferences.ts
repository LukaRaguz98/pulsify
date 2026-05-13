import type { ThemeId } from './themes'

export type { ThemeId }
export type ColorScheme = 'dark' | 'light'
export type LayoutDensity = 'comfortable' | 'compact'

export interface UserPreferences {
  theme: ThemeId
  scheme: ColorScheme
  density: LayoutDensity
  animations: boolean
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'violet',
  scheme: 'dark',
  density: 'comfortable',
  animations: true,
}

export const PREF_COOKIES = {
  theme: 'pulsify-theme',
  scheme: 'pulsify-scheme',
  density: 'pulsify-density',
  animations: 'pulsify-animations',
} as const
