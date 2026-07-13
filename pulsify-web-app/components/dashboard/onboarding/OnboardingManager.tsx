'use client'

import { useMemo, useState, type FC } from 'react'
import {
  DoorOpen, Tags, CalendarDays, Compass, ShieldCheck, Gift, BarChart3,
  AlertTriangle, Check, MessageSquare, Rocket, ChevronDown, Hammer,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { SaveBar } from '@/components/ui/save-bar'
import {
  ONBOARDING_PRESETS, type MemberOnboardingConfig, type OnboardingStats,
} from '@/lib/onboarding'
import { saveMemberOnboarding } from '@/app/dashboard/[guildId]/(management)/onboarding/actions'
import type { MemberEventConfig, PulseRulesConfig } from '@/app/dashboard/[guildId]/(management)/onboarding/actions'
import { type ChannelOpt, type RoleOpt, type EventOpt } from './parts'
import {
  FlowSection, WelcomeSection, RolesSection, EventsSection, CommunitySection,
  VerificationSection, RewardsSection, AnalyticsSection, type SectionProps,
} from './OnboardingSections'
import { OnboardingPreview } from './OnboardingPreview'
import { MemberMessagesManager } from './MemberMessagesManager'

type Perms = { administrator?: boolean; sendMessages?: boolean; manageRoles?: boolean } | null

// Top-level split: "Onboarding" holds the interactive onboarding-embed builder
// (the sub-tabs below); "Messages" is a separate parent for the auto-posted
// welcome/goodbye greetings + server rules.
type ParentTab = 'onboarding' | 'messages'

const PARENT_TABS: { id: ParentTab; label: string; icon: LucideIcon }[] = [
  { id: 'onboarding', label: 'Onboarding', icon: Rocket },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
]

// The builder collapses the old 8 config tabs into one scrollable column of
// collapsible sections (next to a sticky live preview); Analytics stays split
// out since it has no preview.
type TabId = 'builder' | 'analytics'

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'builder', label: 'Builder', icon: Hammer },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
]

type BuilderSectionId = 'flow' | 'welcome' | 'roles' | 'events' | 'community' | 'verification' | 'rewards'

const BUILDER_SECTIONS: {
  id: BuilderSectionId
  label: string
  hint: string
  icon: LucideIcon
  Section: FC<SectionProps>
}[] = [
  { id: 'flow', label: 'Setup', hint: 'Enable, delivery & step order', icon: DoorOpen, Section: FlowSection },
  { id: 'welcome', label: 'Message', hint: 'The welcome embed members see', icon: MessageSquare, Section: WelcomeSection },
  { id: 'roles', label: 'Roles', hint: 'Self-assignable role menus', icon: Tags, Section: RolesSection },
  { id: 'events', label: 'Events', hint: 'Show upcoming server events', icon: CalendarDays, Section: EventsSection },
  { id: 'community', label: 'Community', hint: 'Key channels worth knowing', icon: Compass, Section: CommunitySection },
  { id: 'verification', label: 'Verification', hint: 'Gate entry behind a verify button', icon: ShieldCheck, Section: VerificationSection },
  { id: 'rewards', label: 'Rewards', hint: 'Perks for finishing onboarding', icon: Gift, Section: RewardsSection },
]

export function OnboardingManager({
  guildId, guildName, guildIcon, embedColor, channels, roles, events, perms, initialConfig, stats,
  initialWelcome, initialGoodbye, initialRules,
}: {
  guildId: string
  guildName: string
  guildIcon: string | null
  embedColor: string
  channels: ChannelOpt[]
  roles: RoleOpt[]
  events: EventOpt[]
  perms: Perms
  initialConfig: MemberOnboardingConfig
  stats: OnboardingStats | null
  initialWelcome: Partial<MemberEventConfig> | undefined
  initialGoodbye: Partial<MemberEventConfig> | undefined
  initialRules: Partial<PulseRulesConfig> | undefined
}) {
  const [config, setConfig] = useState<MemberOnboardingConfig>(initialConfig)
  const [baseline, setBaseline] = useState<MemberOnboardingConfig>(initialConfig)
  const [parentTab, setParentTab] = useState<ParentTab>('onboarding')
  const [tab, setTab] = useState<TabId>('builder')
  // Which builder sections are expanded. Setup + Message open by default so the
  // essentials are visible without a wall of controls.
  const [openSections, setOpenSections] = useState<Set<BuilderSectionId>>(new Set(['flow', 'welcome']))
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

  function toggleSection(id: BuilderSectionId) {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
          parentTab === 'onboarding' ? (
            // Read-only status reflecting the *saved* config (baseline) — the
            // actual enable switch lives in the Setup section. Flip on/off there
            // and Save to change this.
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: baseline.enabled ? '#22c55e' : 'var(--text-3)' }} />
              {baseline.enabled ? 'Enabled' : 'Off'}
            </span>
          ) : undefined
        }
      />

      {/* Parent tabs — the onboarding-embed builder vs. the member messages. */}
      <div className="mb-6 inline-flex rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        {PARENT_TABS.map((t) => {
          const active = parentTab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setParentTab(t.id)}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors"
              style={active ? { background: 'var(--p-soft)', color: 'var(--text)' } : { color: 'var(--text-2)' }}
            >
              <t.icon size={15} />
              {t.label}
            </button>
          )
        })}
      </div>

      {parentTab === 'messages' && (
        <MemberMessagesManager
          guildId={guildId}
          guildName={guildName}
          channels={channels}
          initialWelcome={initialWelcome}
          initialGoodbye={initialGoodbye}
          initialRules={initialRules}
        />
      )}

      {parentTab === 'onboarding' && (
      <>
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

      <div className={showPreview ? 'grid gap-6 xl:grid-cols-[1fr_480px]' : ''}>
        <div className="min-w-0">
          {tab === 'builder' && (
            <div className="space-y-3">
              {BUILDER_SECTIONS.map(({ id, label, hint, icon: SectionIcon, Section }) => {
                const open = openSections.has(id)
                return (
                  <div key={id} className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
                    <button
                      type="button"
                      onClick={() => toggleSection(id)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-2)]"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                        <SectionIcon size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-foreground">{label}</span>
                        <span className="block text-xs text-subtle">{hint}</span>
                      </span>
                      <ChevronDown size={16} className="shrink-0 transition-transform" style={{ color: 'var(--text-3)', transform: open ? 'rotate(180deg)' : 'none' }} />
                    </button>
                    {open && (
                      <div className="border-t px-4 py-4" style={{ borderColor: 'var(--line-strong)' }}>
                        <Section {...sectionProps} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {tab === 'analytics' && <AnalyticsSection stats={stats} roles={roles} />}
        </div>

        {showPreview && (
          <aside className="min-w-0">
            <div className="sticky top-6">
              <OnboardingPreview config={config} guildName={guildName} guildIcon={guildIcon} embedColor={embedColor} channels={channels} roles={roles} events={events} />
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
        saveLabel="Save settings"
        cleanText="Onboarding configuration saved."
        dirtyHintText="Review and save to update the member experience."
        confirmTitle="Save onboarding configuration?"
        confirmDescription={config.enabled ? 'This updates the live onboarding experience for new members.' : 'Onboarding is currently disabled — it won’t run until enabled.'}
        confirmLabel="Save settings"
        onReset={() => setConfig(baseline)}
        onSave={handleSave}
      />
      </>
      )}
    </div>
  )
}
