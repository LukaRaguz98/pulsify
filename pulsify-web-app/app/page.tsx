import { LandingNav } from '@/components/landing/LandingNav'
import { Hero } from '@/components/landing/Hero'
import { DashboardPreview } from '@/components/landing/DashboardPreview'
import { Features } from '@/components/landing/Features'
import { Showcases } from '@/components/landing/Showcases'
import { HowItWorks, WhyPulsify } from '@/components/landing/Platform'
import { Pricing } from '@/components/landing/Pricing'
import { Faq } from '@/components/landing/Faq'
import { Community, FinalCta } from '@/components/landing/Community'
import { LandingFooter } from '@/components/landing/LandingFooter'
import { Reveal } from '@/components/landing/Reveal'
import { LandingBackdrop } from '@/components/landing/LandingBackdrop'
import { ScrollProgress } from '@/components/landing/ScrollProgress'
import { BackToTop } from '@/components/landing/BackToTop'
import { isDashboardReady } from '@/lib/auth-state'

export default async function Home() {
  // Resolve auth state server-side so the nav renders the correct CTA on first
  // paint (no "Sign in" flash for logged-in visitors). isDashboardReady requires
  // a validated session AND a live Discord token, so an expired session or a
  // dead Discord connection correctly shows "Sign in" rather than a misleading
  // "Open Dashboard" that would only dump the user on the Reconnect screen.
  const isAuthed = await isDashboardReady()

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <ScrollProgress />
      <LandingBackdrop />
      <LandingNav isAuthed={isAuthed} />
      <main>
        {/* Hero keeps its own load-in animation; the rest reveal on scroll. */}
        <Hero isAuthed={isAuthed} />
        <Reveal><DashboardPreview /></Reveal>
        <Reveal><Features /></Reveal>
        <Reveal><Showcases /></Reveal>
        <Reveal><HowItWorks /></Reveal>
        <Reveal><WhyPulsify /></Reveal>
        <Reveal><Pricing /></Reveal>
        <Reveal><Faq /></Reveal>
        <Reveal><Community /></Reveal>
        <Reveal><FinalCta isAuthed={isAuthed} /></Reveal>
      </main>
      <LandingFooter />
      <BackToTop />
    </div>
  )
}
