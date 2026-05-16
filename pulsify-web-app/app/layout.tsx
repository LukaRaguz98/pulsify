import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'
import type { ThemeId } from '@/lib/themes'
import type { ColorScheme, LayoutDensity, FontSize } from '@/lib/preferences'
import { PREF_COOKIES, DEFAULT_PREFERENCES } from '@/lib/preferences'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'Pulsify',
  description: 'The modern platform for Discord community management. Analytics, automations, events, moderation and more.',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const cookieStore = await cookies()

  const theme = (cookieStore.get(PREF_COOKIES.theme)?.value ?? DEFAULT_PREFERENCES.theme) as ThemeId
  const scheme = (cookieStore.get(PREF_COOKIES.scheme)?.value ?? DEFAULT_PREFERENCES.scheme) as ColorScheme
  const density = (cookieStore.get(PREF_COOKIES.density)?.value ?? DEFAULT_PREFERENCES.density) as LayoutDensity
  const animations = (cookieStore.get(PREF_COOKIES.animations)?.value ?? 'true') !== 'false'
  const cornerDeco = (cookieStore.get(PREF_COOKIES.cornerDeco)?.value ?? 'true') !== 'false'
  const rawCustom = cookieStore.get(PREF_COOKIES.themeCustomColor)?.value
  const themeCustomColor = rawCustom && /^#?[0-9a-fA-F]{6}$/.test(rawCustom)
    ? (rawCustom.startsWith('#') ? rawCustom : `#${rawCustom}`)
    : null
  const rawFontSize = cookieStore.get(PREF_COOKIES.fontSize)?.value
  const fontSize: FontSize = (rawFontSize === 'small' || rawFontSize === 'large')
    ? rawFontSize
    : DEFAULT_PREFERENCES.fontSize
  const ambientGlow = (cookieStore.get(PREF_COOKIES.ambientGlow)?.value ?? 'true') !== 'false'

  // Inline-style the accent CSS vars when a custom color is set, so SSR ships
  // the right colors on first paint (no theme flash).
  const accentStyle = themeCustomColor
    ? ({
        '--p-1': themeCustomColor,
        '--p-2': `color-mix(in srgb, ${themeCustomColor} 80%, black)`,
        '--p-soft': `color-mix(in srgb, ${themeCustomColor} 12%, transparent)`,
        '--p-glow': `color-mix(in srgb, ${themeCustomColor} 45%, transparent)`,
        '--glow-a': `color-mix(in srgb, ${themeCustomColor} 9%, transparent)`,
      } as React.CSSProperties)
    : undefined

  return (
    <html
      lang="en"
      data-theme={theme}
      data-scheme={scheme}
      data-density={density}
      data-animations={String(animations)}
      data-corner-deco={String(cornerDeco)}
      data-font-size={fontSize}
      data-ambient-glow={String(ambientGlow)}
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
      style={accentStyle}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          initialTheme={theme}
          initialScheme={scheme}
          initialDensity={density}
          initialAnimations={animations}
          initialCornerDeco={cornerDeco}
          initialCustomColor={themeCustomColor}
          initialFontSize={fontSize}
          initialAmbientGlow={ambientGlow}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
