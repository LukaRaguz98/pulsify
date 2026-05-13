'use client'

import { createContext, useContext, useState } from 'react'
import type { ThemeId } from '@/lib/themes'

type ThemeContextType = {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'violet',
  setTheme: () => {},
})

export function ThemeProvider({
  children,
  initialTheme,
}: {
  children: React.ReactNode
  initialTheme: ThemeId
}) {
  const [theme, setThemeState] = useState<ThemeId>(initialTheme)

  const setTheme = (next: ThemeId) => {
    setThemeState(next)
    document.documentElement.setAttribute('data-theme', next)
    document.cookie = `pulsify-theme=${next}; path=/; max-age=31536000; SameSite=Lax`
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
