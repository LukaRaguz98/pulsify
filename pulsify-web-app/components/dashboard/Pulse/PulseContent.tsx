'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Sparkles, ShieldAlert } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import type { DiscordChannel, DiscordRole } from '@/lib/discord'
import type { AIModerationSettings } from '@/lib/ai-moderation'
import { PulseAssistantTab } from '@/components/dashboard/Pulse/PulseAssistantTab'
import { AIModerationSettingsTab } from '@/components/dashboard/ai-moderation/AIModerationSettingsTab'

type TabId = 'assistant' | 'moderation'

const TABS: { id: TabId; label: string; description: string; icon: typeof Sparkles }[] = [
  {
    id: 'assistant',
    label: 'General',
    description: 'Configure what Pulse knows about your server when generating content.',
    icon: Sparkles,
  },
  {
    id: 'moderation',
    label: 'Pulse Guard',
    description: 'Tune Pulse Guard — sensitivity, detectors, auto-actions and exclusions.',
    icon: ShieldAlert,
  },
]

type Props = {
  guildId: string
  channels: DiscordChannel[]
  roles: DiscordRole[]
  moderationSettings: AIModerationSettings
}

export function PulseContent({ guildId, channels, roles, moderationSettings }: Props) {
  const searchParams = useSearchParams()
  const [active, setActive] = useState<TabId>(() => {
    const requested = searchParams.get('tab')
    return requested === 'moderation' ? 'moderation' : 'assistant'
  })
  const [currentModSettings, setCurrentModSettings] = useState(moderationSettings)

  const meta = TABS.find((t) => t.id === active)!

  return (
    <div className="page-content max-w-4xl">
      <PageHeader
        title="Pulse"
        description={meta.description}
      />

      <div
        className="mb-6 inline-flex w-full gap-1 rounded-xl border p-1 sm:w-auto"
        style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
      >
        {TABS.map((tab) => {
          const isActive = active === tab.id
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 sm:flex-initial"
              style={{
                background: isActive ? 'var(--panel)' : 'transparent',
                color: isActive ? 'var(--p-1)' : 'var(--text-3)',
                boxShadow: isActive ? '0 1px 4px -1px rgba(0,0,0,0.3), 0 0 0 1px var(--line-strong)' : 'none',
              }}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {active === 'assistant' && <PulseAssistantTab guildId={guildId} />}
      {active === 'moderation' && (
        <AIModerationSettingsTab
          guildId={guildId}
          channels={channels}
          roles={roles}
          initialSettings={currentModSettings}
          onSaved={(next) => setCurrentModSettings(next)}
        />
      )}
    </div>
  )
}
