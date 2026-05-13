import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'
import type { ThemeId } from '@/lib/themes'

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
  const theme = (cookieStore.get('pulsify-theme')?.value ?? 'violet') as ThemeId

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
      </body>
    </html>
  )
}
