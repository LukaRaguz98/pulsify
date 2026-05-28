import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildChannels } from '@/lib/discord'
import { normaliseSettings } from '@/lib/ai-moderation'
import { AIModerationContent } from '@/components/dashboard/AIModerationContent'
import { getCurrentUserPlan } from '@/lib/billing-server'
import { PLAN_LIMITS } from '@/lib/billing'
import { UpgradePrompt } from '@/components/billing/UpgradePrompt'

export default async function AIModerationPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/')

  // Pulse Guard is a Pro+ feature. We block the page here (server-side, with
  // the canonical plan read) so a free user can't even see the configuration
  // surface — the upsell replaces the whole content area. The actions.ts
  // server actions ALSO call requireFeature('aiModeration') so the API path
  // is locked even if someone hits it directly.
  const plan = await getCurrentUserPlan()
  if (!PLAN_LIMITS[plan].aiModeration) {
    return (
      <div className="page-content">
        <UpgradePrompt
          requiredPlan="pro"
          feature="Pulse Guard"
          description="Pulse Guard is Pulsify's AI-driven moderation suite — scam/phishing detection, toxicity scoring and auto-actions. Available on Pro and above."
        />
      </div>
    )
  }

  const [channels, { data: row }] = await Promise.all([
    fetchGuildChannels(guildId),
    supabase
      .from('ai_moderation_settings')
      .select('enabled, sensitivity, settings')
      .eq('guild_id', guildId)
      .maybeSingle(),
  ])

  const rawSettings = (row?.settings as Record<string, unknown> | undefined) ?? {}
  const initialSettings = normaliseSettings({
    ...rawSettings,
    enabled: row?.enabled,
    sensitivity: (row?.sensitivity as 'low' | 'medium' | 'aggressive' | undefined),
  })

  const textChannels = channels.filter((c) => c.type === 0)

  return (
    <AIModerationContent
      guildId={guildId}
      channels={textChannels}
      initialSettings={initialSettings}
    />
  )
}
