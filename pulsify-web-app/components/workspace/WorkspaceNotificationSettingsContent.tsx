'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Bell } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { useRunAction, FeedbackBanner } from '@/components/workspace/feedback'
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_ACCENT,
  ACTIVITY_CATEGORY_LABELS,
  type ActivityCategory,
} from '@/lib/workspace'
import { saveFeedPrefs } from '@/app/workspace/[workspaceId]/activity/actions'

type Props = {
  workspaceId: string
  initialEnabled: Record<string, boolean>
}

/**
 * Per-user notification preferences for a workspace. Mirrors the server
 * dashboard's notification settings shape (bordered button-style "Back to
 * Notifications" link in the PageHeader action, CategorySection wrapping
 * per-category toggles).
 *
 * Persistence: the existing saveFeedPrefs server action upserts into
 * workspace_notification_prefs.enabled_categories — a category is treated as
 * ON unless explicitly set to false.
 */
export function WorkspaceNotificationSettingsContent({ workspaceId, initialEnabled }: Props) {
  const { busy, feedback, setFeedback, run } = useRunAction()
  const [prefs, setPrefs] = useState<Record<string, boolean>>(initialEnabled)

  const isEnabled = (c: ActivityCategory) => prefs[c] !== false

  async function toggle(c: ActivityCategory) {
    const next = { ...prefs, [c]: prefs[c] === false ? true : false }
    setPrefs(next)
    await run(() => saveFeedPrefs(workspaceId, next), 'Preferences saved.')
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Notification settings"
        helpId="workspace-notification-settings"
        description="Choose which workspace events appear in the bell and the notifications list."
        action={
          <Link
            href={`/workspace/${workspaceId}/notifications`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <ArrowLeft size={12} />
            Back to Notifications
          </Link>
        }
      />
      <FeedbackBanner feedback={feedback} onClose={() => setFeedback(null)} />

      <div className="space-y-8">
        <CategorySection
          icon={<Bell size={14} />}
          title="Categories"
          description="Toggle a category off to hide that kind of notification everywhere in this workspace — both the bell dropdown and the full notifications list."
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ACTIVITY_CATEGORIES.map((c) => {
              const on = isEnabled(c)
              const accent = ACTIVITY_CATEGORY_ACCENT[c]
              return (
                <button
                  key={c}
                  type="button"
                  disabled={busy}
                  onClick={() => toggle(c)}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition disabled:opacity-60"
                  style={{
                    borderColor: on ? accent : 'var(--line-strong)',
                    background: on ? `${accent}14` : 'var(--bg-2)',
                  }}
                >
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded border"
                    style={{
                      borderColor: on ? accent : 'var(--line-strong)',
                      background: on ? accent : 'transparent',
                    }}
                  >
                    {on && <Check size={11} className="text-white" />}
                  </span>
                  <span className="text-foreground">{ACTIVITY_CATEGORY_LABELS[c]}</span>
                </button>
              )
            })}
          </div>
        </CategorySection>
      </div>
    </div>
  )
}
