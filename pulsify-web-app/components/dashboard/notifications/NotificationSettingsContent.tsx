'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Bell } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { SectionCard } from '@/components/ui/section-card'
import { CategorySection } from '@/components/ui/category-section'
import { SaveBar } from '@/components/ui/save-bar'
import { useNotifications } from '@/components/dashboard/notifications/NotificationsProvider'
import {
  NOTIFICATION_TYPES,
  TYPE_TO_CATEGORY,
  CATEGORY_LABELS,
  TYPE_LABELS,
  TYPE_DESCRIPTIONS,
  type NotificationCategory,
  type NotificationType,
} from '@/lib/notifications'

// Notification preferences, now their own page reached from the bell dropdown's
// gear (no longer a tab inside Preferences). Lifted verbatim from the old
// Preferences "Notifications" tab.
type NotifDraft = {
  enabled_types: Record<NotificationType, boolean>
  toast_enabled: boolean
}

export function NotificationSettingsContent({ guildId }: { guildId: string }) {
  const { prefs: notifPrefs, savePrefs: persistNotifPrefs } = useNotifications()

  const buildNotifDraft = (): NotifDraft => {
    const types = {} as Record<NotificationType, boolean>
    for (const t of NOTIFICATION_TYPES) {
      types[t] = notifPrefs.enabled_types[t] !== false
    }
    return { enabled_types: types, toast_enabled: notifPrefs.toast_enabled }
  }
  const [notifDraft, setNotifDraft] = useState<NotifDraft>(buildNotifDraft)
  const [notifSnapshot, setNotifSnapshot] = useState<NotifDraft>(buildNotifDraft)

  // Resync draft when the provider's prefs change (initial fetch completes),
  // unless the user has unsaved edits in progress.
  useEffect(() => {
    const fresh = buildNotifDraft()
    setNotifDraft((prev) =>
      JSON.stringify(prev) === JSON.stringify(notifSnapshot) ? fresh : prev,
    )
    setNotifSnapshot(fresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifPrefs])

  const notifChangedCount = useMemo(() => {
    let n = 0
    if (notifDraft.toast_enabled !== notifSnapshot.toast_enabled) n += 1
    for (const t of NOTIFICATION_TYPES) {
      if (notifDraft.enabled_types[t] !== notifSnapshot.enabled_types[t]) n += 1
    }
    return n
  }, [notifDraft, notifSnapshot])
  const notifDirty = notifChangedCount > 0

  function toggleNotifType(type: NotificationType) {
    setNotifDraft((prev) => ({
      ...prev,
      enabled_types: { ...prev.enabled_types, [type]: !prev.enabled_types[type] },
    }))
  }

  function handleResetNotifPrefs() {
    setNotifDraft(notifSnapshot)
  }

  async function handleSaveNotifPrefs() {
    await persistNotifPrefs({
      enabled_types: notifDraft.enabled_types,
      toast_enabled: notifDraft.toast_enabled,
    })
    setNotifSnapshot(notifDraft)
  }

  const notifTypesByCategory = useMemo(() => {
    const groups: Partial<Record<NotificationCategory, NotificationType[]>> = {}
    for (const t of NOTIFICATION_TYPES) {
      const cat = TYPE_TO_CATEGORY[t]
      ;(groups[cat] ??= []).push(t)
    }
    return groups
  }, [])

  return (
    <div className="page-content max-w-4xl">
      <PageHeader
        title="Notification settings"
        description="Pick which server events should notify you and whether to show in-app toasts."
        action={
          <Link
            href={`/dashboard/${guildId}/notifications`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <ArrowLeft size={12} />
            Back to notifications
          </Link>
        }
      />

      <div className="space-y-8">
        <CategorySection
          icon={<Bell size={14} />}
          title="Delivery"
          description="How notifications reach you in the dashboard."
        >
          <SectionCard
            title="In-app toasts"
            description="Show a transient toast in the bottom-right corner when new activity arrives. Notifications still show up in the bell and on the Notifications page regardless of this setting."
          >
            <div
              className="flex items-center justify-between rounded-xl border p-4"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
            >
              <div>
                <p className="text-sm font-semibold text-foreground">Show toasts</p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
                  {notifDraft.toast_enabled
                    ? 'New notifications pop up in the corner for a few seconds.'
                    : 'Notifications are silent — check the bell to see them.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNotifDraft((p) => ({ ...p, toast_enabled: !p.toast_enabled }))}
                className="relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200"
                style={{ background: notifDraft.toast_enabled ? 'var(--p-1)' : 'var(--line-strong)' }}
                aria-checked={notifDraft.toast_enabled}
                role="switch"
              >
                <span
                  className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                  style={{ transform: notifDraft.toast_enabled ? 'translateX(20px)' : 'translateX(0)' }}
                />
              </button>
            </div>
          </SectionCard>
        </CategorySection>

        <CategorySection
          icon={<Bell size={14} />}
          title="Event Types"
          description="Toggle individual event types. Disabled types are also skipped by toasts."
        >
          {(Object.entries(notifTypesByCategory) as [NotificationCategory, NotificationType[]][]).map(([cat, types]) => (
            <SectionCard key={cat} title={CATEGORY_LABELS[cat]} description={`Events grouped under "${CATEGORY_LABELS[cat]}".`}>
              <div>
                {types.map((type, i) => {
                  const enabled = notifDraft.enabled_types[type]
                  const last = i === types.length - 1
                  return (
                    <div
                      key={type}
                      className="flex items-center justify-between py-4"
                      style={{
                        borderBottom: last ? 'none' : '1px solid var(--line-strong)',
                        paddingTop: i === 0 ? 0 : undefined,
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <span style={{ color: enabled ? 'var(--p-1)' : 'var(--text-3)' }}>
                          <Bell size={18} />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{TYPE_LABELS[type]}</p>
                          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                            {TYPE_DESCRIPTIONS[type]}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleNotifType(type)}
                        className="relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200"
                        style={{ background: enabled ? 'var(--p-1)' : 'var(--line-strong)' }}
                        aria-checked={enabled}
                        role="switch"
                      >
                        <span
                          className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                          style={{ transform: enabled ? 'translateX(20px)' : 'translateX(0)' }}
                        />
                      </button>
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          ))}
        </CategorySection>

        <SaveBar
          dirty={notifDirty}
          changedCount={notifChangedCount}
          saveLabel="Save Preferences"
          cleanText="All notification preferences saved."
          dirtyHintText="review and save to apply."
          confirmTitle="Save notification preferences?"
          confirmDescription="These preferences are stored per user, per server."
          confirmLabel="Save Preferences"
          onReset={handleResetNotifPrefs}
          onSave={handleSaveNotifPrefs}
        />
      </div>
    </div>
  )
}
