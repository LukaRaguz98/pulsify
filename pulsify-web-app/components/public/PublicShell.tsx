import { LandingBackdrop } from '@/components/landing/LandingBackdrop'
import { LandingFooter } from '@/components/landing/LandingFooter'
import { BackToTop } from '@/components/landing/BackToTop'
import { ScrollProgress } from '@/components/landing/ScrollProgress'
import { PublicHeader } from './PublicHeader'
import { PublicBreadcrumb } from './PublicBreadcrumb'

/**
 * Shared chrome for the public pages (privacy, terms, support, community).
 * Reuses the landing-page backdrop, footer and helpers so every public page
 * shares the homepage's branding, with a context-aware header + breadcrumb on
 * top. `authed` tailors the "back" path and CTA to where the user came from.
 */
export function PublicShell({ authed, children }: { authed: boolean; children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <ScrollProgress />
      <LandingBackdrop />
      <PublicHeader authed={authed} />
      <PublicBreadcrumb authed={authed} />
      <main className="relative flex-1">{children}</main>
      <LandingFooter />
      <BackToTop />
    </div>
  )
}
