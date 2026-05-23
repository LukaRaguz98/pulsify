'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { RotateCcw, Loader2, Rocket } from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { SectionCard } from '@/components/ui/section-card'
import { resetOnboarding } from '@/app/dashboard/[guildId]/onboarding/actions'

/**
 * Settings entry to re-run the guided setup. Clears onboarding state (so the
 * first-run banner returns and the wizard starts fresh) then opens the wizard.
 * Applied feature config is left intact.
 */
export function RestartOnboardingCard() {
  const params = useParams<{ guildId: string }>()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const guildId = params?.guildId

  async function rerun() {
    if (!guildId) return
    setBusy(true)
    await resetOnboarding(guildId).catch(() => {})
    router.push(`/dashboard/${guildId}/onboarding`)
  }

  return (
    <CategorySection
      icon={<Rocket size={14} />}
      title="Guided setup"
      description="Re-run the first-time onboarding for this server."
    >
      <SectionCard
        title="Setup wizard"
        description="Walk through connecting Pulse, primary channels and the quick-setup templates (moderation, welcome, auto-roles, Pulse Guard) again. Your existing configuration stays in place unless you change it."
      >
        <button
          type="button"
          onClick={rerun}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
          Re-run setup wizard
        </button>
      </SectionCard>
    </CategorySection>
  )
}
