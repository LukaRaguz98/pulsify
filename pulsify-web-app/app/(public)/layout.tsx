import { PublicShell } from '@/components/public/PublicShell'
import { isDashboardReady } from '@/lib/auth-state'

// Shared shell for the public marketing/legal pages. The route group `(public)`
// keeps the URLs clean (/privacy, /terms, /support, /community) while letting
// these pages share one layout, loading and error boundary.
//
// We resolve auth state here so the chrome is context-aware: a signed-in admin
// (who likely arrived from the dashboard footer) gets a "back to dashboard"
// path and an "Open Dashboard" CTA instead of a misplaced "Sign in". We use
// isDashboardReady (validated session + live Discord token) rather than a bare
// cookie check so an expired session / dead Discord token shows "Sign in".
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const authed = await isDashboardReady()
  return <PublicShell authed={authed}>{children}</PublicShell>
}
