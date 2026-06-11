'use client'

import { useMemo, useState } from 'react'
import {
  Workflow, Hand, Tags, CalendarDays, Compass, ShieldCheck, Gift, BarChart3,
  Eye, AlertTriangle, Check, type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { SaveBar } from '@/components/ui/save-bar'
import {
  ONBOARDING_PRESETS, type MemberOnboardingConfig, type OnboardingStats,
} from '@/lib/onboarding'
import { saveMemberOnboarding } from '@/app/dashboard/[guildId]/(management)/onboarding/actions'
import { Toggle, type ChannelOpt, type RoleOpt, type EventOpt } from './parts'
import {
  FlowSection, WelcomeSection, RolesSection, EventsSection, CommunitySection,
  VerificationSection, RewardsSection, AnalyticsSection, type SectionProps,
} from './OnboardingSections'
import { OnboardingPreview } from './OnboardingPreview'

type Perms = { administrator?: boolean; sendMessages?: boolean; manageRoles?: boolean } | null

type TabId = 'flow' | 'welcome' | 'roles' | 'events' | 'community' | 'verification' | 'rewards' | 'analytics'

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'flow', label: 'Flow', icon: Workflow },
  { id: 'welcome', label: 'Welcome', icon: Hand },
  { id: 'roles', label: 'Roles', icon: Tags },
  { id: 'events', label: 'Events', icon: CalendarDays },
  { id: 'community', label: 'Community', icon: Compass },
  { id: 'verification', label: 'Verification', icon: ShieldCheck },
  { id: 'rewards', label: 'Rewards', icon: Gift },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
]

export function OnboardingManager({
  guildId, guildName, guildIcon, channels, roles, events, perms, initialConfig, stats,
}: {
  guildId: string
  guildName: string
  guildIcon: string | null
  channels: ChannelOpt[]
  roles: RoleOpt[]
  events: EventOpt[]
  perms: Perms
  initialConfig: MemberOnboardingConfig
  stats: OnboardingStats | null
}) {
  const [config, setConfig] = useState<MemberOnboardingConfig>(initialConfig)
  const [baseline, setBaseline] = useState<MemberOnboardingConfig>(initialConfig)
  const [tab, setTab] = useState<TabId>('flow')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(baseline), [config, baseline])

  function patch(p: Partial<MemberOnboardingConfig>) {
    setConfig((c) => ({ ...c, ...p }))
  }

  function applyPreset(id: string) {
    const preset = ONBOARDING_PRESETS.find((p) => p.id === id)
    if (preset) setConfig((c) => preset.apply(c))
  }

  async function handleSave() {
    setSaving(true)
    setToast(null)
    const res = await saveMemberOnboarding(guildId, config)
    setSaving(false)
    if (res.ok) {
      setBaseline(config)
      setToast({ kind: 'ok', msg: 'Onboarding saved.' })
    } else {
      setToast({ kind: 'err', msg: res.error })
    }
    setTimeout(() => setToast(null), 4000)
  }

  const sectionProps: SectionProps = { config, patch, channels, roles, events, guildName }

  // Permission heads-up when capabilities the config relies on are missing.
  const missingPerm =
    perms && !perms.administrator
      ? [
          (config.delivery === 'channel') && !perms.sendMessages ? 'Send Messages' : null,
          (config.verification.enabled || config.rewards.role_ids.length > 0 || config.roleCategories.length > 0) && !perms.manageRoles ? 'Manage Roles' : null,
        ].filter(Boolean)
      : []

  const showPreview = tab !== 'analytics'

  return (
    <div className="page-content">
      <PageHeader
        title="Onboarding & Welcome"
        helpId="onboarding"
        description="Guide new members with an interactive welcome — self-roles, verification, events, community links and completion rewards."
        action={
          <label className="inline-flex items-center gap-2.5 rounded-xl border px-4 py-2.5" style={{ borderColor: config.enabled ? 'var(--p-1)' : 'var(--line-strong)', background: 'var(--panel)' }}>
            <span className="text-sm font-medium text-foreground">{config.enabled ? 'Enabled' : 'Disabled'}</span>
            <Toggle checked={config.enabled} onChange={(v) => patch({ enabled: v })} />
          </label>
        }
      />

      {/* Presets */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Start from a preset:</span>
        {ONBOARDING_PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => applyPreset(p.id)} className="rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:border-[var(--p-1)]" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
            {p.label}
          </button>
        ))}
      </div>

      {missingPerm.length > 0 && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}>
          <AlertTriangle size={15} className="shrink-0" />
          Pulse is missing <strong>{missingPerm.join(' & ')}</strong> — some onboarding actions may fail until granted.
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 inline-flex flex-wrap rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors"
              style={active ? { background: 'var(--p-soft)', color: 'var(--text)' } : { color: 'var(--text-2)' }}
            >
              <span style={active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}><t.icon size={15} /></span>
              {t.label}
            </button>
          )
        })}
      </div>

      <div className={showPreview ? 'grid gap-6 xl:grid-cols-[1fr_380px]' : ''}>
        <div className="min-w-0">
          {tab === 'flow' && <FlowSection {...sectionProps} />}
          {tab === 'welcome' && <WelcomeSection {...sectionProps} />}
          {tab === 'roles' && <RolesSection {...sectionProps} />}
          {tab === 'events' && <EventsSection {...sectionProps} />}
          {tab === 'community' && <CommunitySection {...sectionProps} />}
          {tab === 'verification' && <VerificationSection {...sectionProps} />}
          {tab === 'rewards' && <RewardsSection {...sectionProps} />}
          {tab === 'analytics' && <AnalyticsSection stats={stats} roles={roles} />}
        </div>

        {showPreview && (
          <aside className="min-w-0">
            <div className="sticky top-6">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--text-3)' }}>
                <Eye size={13} /> Live preview
              </div>
              <OnboardingPreview config={config} guildName={guildName} guildIcon={guildIcon} channels={channels} roles={roles} events={events} />
            </div>
          </aside>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-lg" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: toast.kind === 'ok' ? '#22c55e' : '#f87171' }}>
          <span className="flex items-center gap-1.5">{toast.kind === 'ok' ? <Check size={14} /> : <AlertTriangle size={14} />}{toast.msg}</span>
        </div>
      )}

      <SaveBar
        dirty={dirty}
        saving={saving}
        saveLabel="Save onboarding"
        cleanText="Onboarding configuration saved."
        dirtyHintText="Review and save to update the member experience."
        confirmTitle="Save onboarding configuration?"
        confirmDescription={config.enabled ? 'This updates the live onboarding experience for new members.' : 'Onboarding is currently disabled — it won’t run until enabled.'}
        confirmLabel="Save"
        onReset={() => setConfig(baseline)}
        onSave={handleSave}
      />
    </div>
  )
}
