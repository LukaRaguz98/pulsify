'use client'

import { createContext, useContext, useState } from 'react'
import type { ThemeId } from '@/lib/themes'
import type { ColorScheme, LayoutDensity } from '@/lib/preferences'
import { PREF_COOKIES } from '@/lib/preferences'

type PreferencesContextType = {
  theme: ThemeId
  scheme: ColorScheme
  density: LayoutDensity
  animations: boolean
  cornerDeco: boolean
  setTheme: (theme: ThemeId) => void
  setScheme: (scheme: ColorScheme) => void
  setDensity: (density: LayoutDensity) => void
  setAnimations: (on: boolean) => void
  setCornerDeco: (on: boolean) => void
}

const PreferencesContext = createContext<PreferencesContextType>({
  theme: 'violet',
  scheme: 'dark',
  density: 'comfortable',
  animations: true,
  cornerDeco: true,
  setTheme: () => {},
  setScheme: () => {},
  setDensity: () => {},
  setAnimations: () => {},
  setCornerDeco: () => {},
})

function saveCookie(key: string, value: string) {
  document.cookie = `${key}=${value}; path=/; max-age=31536000; SameSite=Lax`
}

export function ThemeProvider({
  children,
  initialTheme,
  initialScheme = 'dark',
  initialDensity = 'comfortable',
  initialAnimations = true,
  initialCornerDeco = true,
}: {
  children: React.ReactNode
  initialTheme: ThemeId
  initialScheme?: ColorScheme
  initialDensity?: LayoutDensity
  initialAnimations?: boolean
  initialCornerDeco?: boolean
}) {
  const [theme, setThemeState] = useState<ThemeId>(initialTheme)
  const [scheme, setSchemeState] = useState<ColorScheme>(initialScheme)
  const [density, setDensityState] = useState<LayoutDensity>(initialDensity)
  const [animations, setAnimationsState] = useState<boolean>(initialAnimations)
  const [cornerDeco, setCornerDecoState] = useState<boolean>(initialCornerDeco)

  const setTheme = (next: ThemeId) => {
    setThemeState(next)
    document.documentElement.setAttribute('data-theme', next)
    saveCookie(PREF_COOKIES.theme, next)
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

  return (
    <PreferencesContext.Provider
      value={{ theme, scheme, density, animations, cornerDeco, setTheme, setScheme, setDensity, setAnimations, setCornerDeco }}
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
