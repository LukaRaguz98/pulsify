import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getValidDiscordToken } from '@/lib/discord-session'
import { fetchGuild, fetchSelfUser, userBannerUrl } from '@/lib/discord'
import { GuildSidebar } from '@/components/dashboard/GuildSidebar'
import { CornerDecorations } from '@/components/dashboard/CornerDecorations'
import { DiscordCornerIcon } from '@/components/dashboard/DiscordCornerIcon'
import { Footer } from '@/components/Footer'
import { NotificationsProvider } from '@/components/dashboard/notifications/NotificationsProvider'
import { NotificationBell } from '@/components/dashboard/notifications/NotificationBell'
import { Toaster } from '@/components/dashboard/notifications/Toaster'
import { PingIndicator } from '@/components/dashboard/PingIndicator'
import { CommandPaletteProvider } from '@/components/dashboard/search/CommandPaletteProvider'
import { PlanProvider } from '@/components/billing/PlanProvider'
import {
  getSubscriptionRow,
  toClientSubscription,
} from '@/lib/billing-server'
import { effectivePlan, isEarlyAccess, EARLY_ACCESS_PLAN } from '@/lib/billing'
import { isCurrentUserOperator } from '@/lib/operator'

export default async function GuildLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) redirect('/')

  const providerToken = await getValidDiscordToken({
    access_token: session.provider_token,
    refresh_token: session.provider_refresh_token,
  })
  const [guild, selfUser] = await Promise.all([
    fetchGuild(guildId),
    providerToken ? fetchSelfUser(providerToken) : null,
  ])
  if (!guild) redirect('/dashboard')

  const discordId = session.user.user_metadata?.provider_id ?? session.user.id
  const bannerUrl = selfUser?.banner ? userBannerUrl(selfUser.id ?? discordId, selfUser.banner) : undefined

  // Resolve the user's effective plan once at layout level so every client
  // component below can render plan-aware UI without a network round-trip.
  // Server routes still re-verify (lib/billing-server.requirePlan) — this
  // provider is a UX hint, not a security boundary.
  const subscriptionRow = await getSubscriptionRow(discordId)
  const subscription = toClientSubscription(subscriptionRow)
  // Bot-wide surfaces (e.g. Presence) are operator-only, so the nav item is
  // hidden from everyone else. Resolved server-side; the page re-checks too.
  const isOperator = await isCurrentUserOperator()
  // During early access everyone is the top tier so the whole dashboard UI is
  // unlocked; the `earlyAccess` flag lets client components soften plan-specific
  // copy (no upsells, "free during early access").
  const earlyAccess = isEarlyAccess()
  const plan = earlyAccess ? EARLY_ACCESS_PLAN : effectivePlan(subscriptionRow?.plan, subscriptionRow?.status)

  return (
    <NotificationsProvider guildId={guildId}>
      <CommandPaletteProvider guildId={guildId}>
        <PlanProvider plan={plan} subscription={subscription} earlyAccess={earlyAccess}>
          <div className="flex h-screen overflow-hidden bg-background text-foreground">
            <GuildSidebar
              guild={guild}
              guildId={guildId}
              user={session.user}
              selfUser={selfUser ?? undefined}
              bannerUrl={bannerUrl}
              isOperator={isOperator}
            />
            <CornerDecorations />
            <DiscordCornerIcon guildId={guildId} />
            <NotificationBell guildId={guildId} />
            <PingIndicator />
            {/* overflow-x-hidden: `overflow-y-auto` alone makes the browser
                compute overflow-x to `auto`, turning this scroll container into a
                horizontal one whenever a child is slightly too wide — that's what
                let pages drag left/right on mobile. Clipping the cross-axis stops
                it app-wide; genuinely wide children (e.g. tables) keep their own
                inner overflow-x-auto scroll. */}
            <main className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col">
              {/* max-lg:pt-12 clears the fixed mobile top bar (h-12) rendered by
                  GuildSidebar on small screens; desktop has no offset. */}
              <div className="flex-1 max-lg:pt-12">{children}</div>
              <Footer />
            </main>
            <Toaster />
          </div>
        </PlanProvider>
      </CommandPaletteProvider>
    </NotificationsProvider>
  )
}
