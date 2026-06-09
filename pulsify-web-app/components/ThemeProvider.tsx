'use client'

import { createContext, useContext, useState } from 'react'
import type { ThemeId } from '@/lib/themes'
import type { ColorScheme, LayoutDensity, FontSize } from '@/lib/preferences'
import { PREF_COOKIES } from '@/lib/preferences'

type PreferencesContextType = {
  theme: ThemeId
  scheme: ColorScheme
  density: LayoutDensity
  animations: boolean
  cornerDeco: boolean
  themeCustomColor: string | null
  fontSize: FontSize
  ambientGlow: boolean
  pingIndicator: boolean
  contextualHelp: boolean
  setTheme: (theme: ThemeId) => void
  setScheme: (scheme: ColorScheme) => void
  setDensity: (density: LayoutDensity) => void
  setAnimations: (on: boolean) => void
  setCornerDeco: (on: boolean) => void
  /** Pass `null` to clear the custom accent and fall back to the preset theme. */
  setThemeCustomColor: (color: string | null) => void
  setFontSize: (size: FontSize) => void
  setAmbientGlow: (on: boolean) => void
  setPingIndicator: (on: boolean) => void
  setContextualHelp: (on: boolean) => void
}

const PreferencesContext = createContext<PreferencesContextType>({
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
  setTheme: () => {},
  setScheme: () => {},
  setDensity: () => {},
  setAnimations: () => {},
  setCornerDeco: () => {},
  setThemeCustomColor: () => {},
  setFontSize: () => {},
  setAmbientGlow: () => {},
  setPingIndicator: () => {},
  setContextualHelp: () => {},
})

function saveCookie(key: string, value: string) {
  document.cookie = `${key}=${value}; path=/; max-age=31536000; SameSite=Lax`
}

function clearCookie(key: string) {
  document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax`
}

// The four accent CSS vars derived from a single hex color. Keeping these in
// one place so SSR (app/layout.tsx) and CSR (this provider) stay in sync.
const ACCENT_VARS = ['--p-1', '--p-2', '--p-soft', '--p-glow', '--glow-a'] as const

function applyCustomAccent(color: string | null) {
  const root = document.documentElement
  if (!color) {
    for (const v of ACCENT_VARS) root.style.removeProperty(v)
    return
  }
  root.style.setProperty('--p-1', color)
  root.style.setProperty('--p-2', `color-mix(in srgb, ${color} 80%, black)`)
  root.style.setProperty('--p-soft', `color-mix(in srgb, ${color} 12%, transparent)`)
  root.style.setProperty('--p-glow', `color-mix(in srgb, ${color} 45%, transparent)`)
  root.style.setProperty('--glow-a', `color-mix(in srgb, ${color} 9%, transparent)`)
}

export function ThemeProvider({
  children,
  initialTheme,
  initialScheme = 'dark',
  initialDensity = 'comfortable',
  initialAnimations = true,
  initialCornerDeco = false,
  initialCustomColor = null,
  initialFontSize = 'medium',
  initialAmbientGlow = true,
  initialPingIndicator = true,
  initialContextualHelp = true,
}: {
  children: React.ReactNode
  initialTheme: ThemeId
  initialScheme?: ColorScheme
  initialDensity?: LayoutDensity
  initialAnimations?: boolean
  initialCornerDeco?: boolean
  initialCustomColor?: string | null
  initialFontSize?: FontSize
  initialAmbientGlow?: boolean
  initialPingIndicator?: boolean
  initialContextualHelp?: boolean
}) {
  const [theme, setThemeState] = useState<ThemeId>(initialTheme)
  const [scheme, setSchemeState] = useState<ColorScheme>(initialScheme)
  const [density, setDensityState] = useState<LayoutDensity>(initialDensity)
  const [animations, setAnimationsState] = useState<boolean>(initialAnimations)
  const [cornerDeco, setCornerDecoState] = useState<boolean>(initialCornerDeco)
  const [themeCustomColor, setThemeCustomColorState] = useState<string | null>(initialCustomColor)
  const [fontSize, setFontSizeState] = useState<FontSize>(initialFontSize)
  const [ambientGlow, setAmbientGlowState] = useState<boolean>(initialAmbientGlow)
  const [pingIndicator, setPingIndicatorState] = useState<boolean>(initialPingIndicator)
  const [contextualHelp, setContextualHelpState] = useState<boolean>(initialContextualHelp)

  const setTheme = (next: ThemeId) => {
    setThemeState(next)
    document.documentElement.setAttribute('data-theme', next)
    saveCookie(PREF_COOKIES.theme, next)
    // Selecting a preset clears any custom override so the preset's accent wins.
    if (themeCustomColor !== null) {
      setThemeCustomColorState(null)
      applyCustomAccent(null)
      clearCookie(PREF_COOKIES.themeCustomColor)
    }
  }

  const setScheme = (next: ColorScheme) => {
    setSchemeState(next)
    document.documentElement.setAttribute('data-scheme', next)
    saveCookie(PREF_COOKIES.scheme, next)
  }

  const setDensity = (next: LayoutDensity) => {
    setDensityState(next)
    document.documentElement.setAttribute('data-density', next)
    saveCookie(PREF_COOKIES.density, next)
  }

  const setAnimations = (on: boolean) => {
    setAnimationsState(on)
    document.documentElement.setAttribute('data-animations', String(on))
    saveCookie(PREF_COOKIES.animations, String(on))
  }

  const setCornerDeco = (on: boolean) => {
    setCornerDecoState(on)
    document.documentElement.setAttribute('data-corner-deco', String(on))
    saveCookie(PREF_COOKIES.cornerDeco, String(on))
  }

  const setThemeCustomColor = (next: string | null) => {
    setThemeCustomColorState(next)
    applyCustomAccent(next)
    if (next) saveCookie(PREF_COOKIES.themeCustomColor, next)
    else clearCookie(PREF_COOKIES.themeCustomColor)
  }

  const setFontSize = (next: FontSize) => {
    setFontSizeState(next)
    document.documentElement.setAttribute('data-font-size', next)
    saveCookie(PREF_COOKIES.fontSize, next)
  }

  const setAmbientGlow = (on: boolean) => {
    setAmbientGlowState(on)
    document.documentElement.setAttribute('data-ambient-glow', String(on))
    saveCookie(PREF_COOKIES.ambientGlow, String(on))
  }

  const setPingIndicator = (on: boolean) => {
    setPingIndicatorState(on)
    saveCookie(PREF_COOKIES.pingIndicator, String(on))
  }

  const setContextualHelp = (on: boolean) => {
    setContextualHelpState(on)
    document.documentElement.setAttribute('data-contextual-help', String(on))
    saveCookie(PREF_COOKIES.contextualHelp, String(on))
  }

  return (
    <PreferencesContext.Provider
      value={{
        theme, scheme, density, animations, cornerDeco, themeCustomColor, fontSize, ambientGlow, pingIndicator, contextualHelp,
        setTheme, setScheme, setDensity, setAnimations, setCornerDeco, setThemeCustomColor,
        setFontSize, setAmbientGlow, setPingIndicator, setContextualHelp,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  )
}

export function usePreferences() {
  return useContext(PreferencesContext)
}

export function useTheme() {
  const { theme, setTheme } = useContext(PreferencesContext)
  return { theme, setTheme }
}
