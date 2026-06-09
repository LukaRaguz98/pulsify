'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import type { DiscordChannel, DiscordRole } from '@/lib/discord'
import type { AIModerationSettings } from '@/lib/ai-moderation'
import { AIModerationSettingsTab } from './AIModerationSettingsTab'

type Props = {
  guildId: string
  channels: DiscordChannel[]
  roles: DiscordRole[]
  initialSettings: AIModerationSettings
}

/**
 * Standalone Pulse Guard settings page (reached from the "Settings" button on
 * the Pulse Guard view, the same way Tickets links to /ticket-settings). Wraps
 * the existing AIModerationSettingsTab with a PageHeader + back link and keeps a
 * local copy of the settings so the tab's onSaved sync has somewhere to land.
 */
export function AIModerationSettingsContent({ guildId, channels, roles, initialSettings }: Props) {
  const [settings, setSettings] = useState(initialSettings)

  return (
    <div className="page-content">
      <PageHeader
        title="Pulse Guard settings"
        helpId="pulse-guard-settings"
        description="Tune Pulse Guard — sensitivity, detectors, auto-actions and exclusions."
        action={
          <Link
            href={`/dashboard/${guildId}/ai-moderation`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <ArrowLeft size={12} />
            Back to Pulse Guard
          </Link>
        }
      />

      <AIModerationSettingsTab
        guildId={guildId}
        channels={channels}
        roles={roles}
        initialSettings={settings}
        onSaved={(next) => setSettings(next)}
      />
    </div>
  )
}
