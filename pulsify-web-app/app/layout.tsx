import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'
import type { ThemeId } from '@/lib/themes'
import type { ColorScheme, LayoutDensity } from '@/lib/preferences'
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

  return (
    <html
      lang="en"
      data-theme={theme}
      data-scheme={scheme}
      data-density={density}
      data-animations={String(animations)}
      data-corner-deco={String(cornerDeco)}
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          initialTheme={theme}
          initialScheme={scheme}
          initialDensity={density}
          initialAnimations={animations}
          initialCornerDeco={cornerDeco}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
