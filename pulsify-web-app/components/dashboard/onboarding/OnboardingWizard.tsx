'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  Sparkles, Plug, Zap, CheckCircle2, Gamepad2, Users, GraduationCap, Briefcase, Globe,
  Feather, Scale, ShieldAlert, LayoutGrid, LayoutList, Hand, UserPlus, Shield, BarChart3,
  ArrowLeft, ArrowRight, Check, X, Loader2, AlertTriangle, ExternalLink,
  RefreshCw, PartyPopper, type LucideIcon,
} from 'lucide-react'
import { usePreferences } from '@/components/ThemeProvider'
import { botInviteUrl, type BotPermissions } from '@/lib/discord'
import { THEMES } from '@/lib/themes'
import type { LayoutDensity } from '@/lib/preferences'
import {
  ONBOARDING_STEPS, STEP_COUNT, SERVER_TYPES, MOD_INTENSITIES, LAYOUT_OPTIONS,
  FEATURE_TEMPLATES, recommendedFeatures, welcomeMessageFor, sensitivityForIntensity,
  type FeatureKey, type ModSensitivity, type OnboardingSelections, type OnboardingState,
} from '@/lib/onboarding'
import {
  saveOnboardingProgress, skipOnboarding, applyOnboardingSetup,
  type ApplyOutcome,
} from '@/app/dashboard/[guildId]/onboarding/actions'

const ICONS: Record<string, LucideIcon> = {
  Sparkles, Plug, Zap, CheckCircle2, Gamepad2, Users, GraduationCap, Briefcase, Globe,
  Feather, Scale, ShieldAlert, LayoutGrid, LayoutList, Hand, UserPlus, Shield, BarChart3,
}
function CIcon({ name, size = 18 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? Sparkles
  return <C size={size} />
}

type ChannelOpt = { id: string; name: string; type: number }
type RoleOpt = { id: string; name: string; color: number }

type Props = {
  guildId: string
  guildName: string
  guildIcon: string | null
  channels: ChannelOpt[]
  roles: RoleOpt[]
  perms: BotPermissions | null
  defaults: { welcomeChannelId: string; modChannelId: string; autoRoleId: string }
  initialState: OnboardingState | null
}

export function OnboardingWizard(props: Props) {
  const { guildId, guildName, guildIcon, channels, roles, perms, defaults, initialState } = props
  const router = useRouter()
  const prefs = usePreferences()

  // Resume mid-flow only while still in progress; a completed/skipped server
  // re-entering the wizard (e.g. to re-test) starts fresh at step one.
  const [step, setStep] = useState(() =>
    initialState?.status === 'in_progress'
      ? Math.min(Math.max(initialState.step, 0), STEP_COUNT - 1)
      : 0,
  )
  const [selections, setSelections] = useState<OnboardingSelections>(() => ({
    layout: prefs.density,
    theme: prefs.theme,
    ...(initialState?.selections ?? {}),
  }))

  const [features, setFeatures] = useState<Record<FeatureKey, boolean>>(() =>
    recommendedFeatures(initialState?.selections ?? {}),
  )
  const [welcomeChannelId, setWelcomeChannelId] = useState(defaults.welcomeChannelId)
  const [modChannelId, setModChannelId] = useState(defaults.modChannelId)
  const [autoRoleId, setAutoRoleId] = useState(defaults.autoRoleId)
  const [welcomeMessage, setWelcomeMessage] = useState(() => welcomeMessageFor(initialState?.selections?.serverType))
  const [welcomeEdited, setWelcomeEdited] = useState(false)
  const [guardSensitivity, setGuardSensitivity] = useState<ModSensitivity>(() =>
    sensitivityForIntensity(initialState?.selections?.modIntensity),
  )

  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ApplyOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  const persist = (nextStep: number, sel: OnboardingSelections) => {
    void saveOnboardingProgress(guildId, nextStep, sel).catch(() => {})
  }

  function patchSelections(patch: Partial<OnboardingSelections>) {
    setSelections((prev) => ({ ...prev, ...patch }))
  }

  function pickServerType(id: string) {
    patchSelections({ serverType: id })
    if (!welcomeEdited) setWelcomeMessage(welcomeMessageFor(id))
  }
  function pickIntensity(id: string) {
    patchSelections({ modIntensity: id })
    setGuardSensitivity(sensitivityForIntensity(id))
    // Re-apply the recommendation for Pulse Guard as intensity changes.
    setFeatures((f) => ({ ...f, pulse_guard: id !== 'relaxed' }))
  }
  function pickLayout(id: LayoutDensity) {
    patchSelections({ layout: id })
    prefs.setDensity(id) // live preview + persisted to cookie
  }
  function pickTheme(id: (typeof THEMES)[number]['id']) {
    patchSelections({ theme: id })
    prefs.setTheme(id)
  }

  const last = STEP_COUNT - 1
  function goNext() {
    if (step === last) {
      void finish()
      return
    }
    const next = step + 1
    setStep(next)
    persist(next, selections)
  }
  function goBack() {
    const prev = Math.max(0, step - 1)
    setStep(prev)
    persist(prev, selections)
  }

  async function handleSkip() {
    setBusy(true)
    await skipOnboarding(guildId).catch(() => {})
    router.push(`/dashboard/${guildId}`)
  }

  async function finish() {
    setBusy(true)
    setError(null)
    const res = await applyOnboardingSetup(guildId, {
      selections,
      welcome: features.welcome ? { channel_id: welcomeChannelId, message: welcomeMessage } : undefined,
      auto_role: features.auto_role && autoRoleId ? { role_id: autoRoleId } : undefined,
      moderation: features.moderation ? { channel_id: modChannelId } : undefined,
      pulse_guard: features.pulse_guard ? { sensitivity: guardSensitivity } : undefined,
      analytics: features.analytics,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOutcome(res)
  }

  // ── Success screen ──────────────────────────────────────────────────────
  if (outcome) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:py-20">
        <div className="onboarding-step rounded-2xl border p-8 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
            <PartyPopper size={32} />
          </span>
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">You’re all set!</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-2)' }}>
            {guildName} is ready to go. Here’s what we turned on:
          </p>
          <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left">
            {outcome.applied.length === 0 && (
              <li className="text-sm" style={{ color: 'var(--text-3)' }}>No features enabled — you can set them up any time from the sidebar.</li>
            )}
            {outcome.applied.map((k) => {
              const f = FEATURE_TEMPLATES.find((t) => t.key === k)!
              return (
                <li key={k} className="flex items-center gap-2.5 rounded-lg border px-3 py-2" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
                  <Check size={15} style={{ color: 'var(--green)' }} />
                  <span className="text-sm font-medium text-foreground">{f.label}</span>
                </li>
              )
            })}
          </ul>
          {outcome.warnings.length > 0 && (
            <div className="mx-auto mt-5 max-w-sm space-y-2 text-left">
              {outcome.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}>
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => { router.push(`/dashboard/${guildId}`); router.refresh() }}
            className="mt-8 inline-flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all active:translate-y-px"
            style={{ background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)', boxShadow: '0 6px 20px -6px var(--p-glow)' }}
          >
            Go to dashboard <ArrowRight size={16} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      {/* Header */}
      <div className="mb-7 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {guildIcon ? (
            <Image src={guildIcon} alt="" width={36} height={36} className="rounded-xl" unoptimized />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
              {guildName.charAt(0).toUpperCase()}
            </span>
          )}
          <div>
            <h1 className="text-lg font-bold tracking-tight text-foreground">Set up Pulse</h1>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{guildName}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSkip}
          disabled={busy}
          className="text-sm font-medium transition-colors disabled:opacity-50"
          style={{ color: 'var(--text-3)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
        >
          Skip for now
        </button>
      </div>

      {/* Stepper */}
      <Stepper current={step} />

      {/* Step body */}
      <div key={step} className="onboarding-step mt-8">
        {step === 0 && (
          <StepShell title="Make it yours" subtitle="A few quick choices so we can recommend the right setup. You can change anything later.">
            <FieldGroup label="What kind of server is this?">
              <CardGrid>
                {SERVER_TYPES.map((s) => (
                  <OptionCard key={s.id} icon={s.icon} label={s.label} desc={s.desc} active={selections.serverType === s.id} onClick={() => pickServerType(s.id)} />
                ))}
              </CardGrid>
            </FieldGroup>

            <FieldGroup label="How strict should moderation be?">
              <CardGrid cols={3}>
                {MOD_INTENSITIES.map((m) => (
                  <OptionCard key={m.id} icon={m.icon} label={m.label} desc={m.desc} active={selections.modIntensity === m.id} onClick={() => pickIntensity(m.id)} />
                ))}
              </CardGrid>
            </FieldGroup>

            <FieldGroup label="Dashboard layout">
              <CardGrid cols={2}>
                {LAYOUT_OPTIONS.map((l) => (
                  <OptionCard key={l.id} icon={l.icon} label={l.label} desc={l.desc} active={prefs.density === l.id} onClick={() => pickLayout(l.id)} />
                ))}
              </CardGrid>
            </FieldGroup>

            <FieldGroup label="Accent theme">
              <div className="flex flex-wrap gap-2.5">
                {THEMES.map((t) => {
                  const active = prefs.theme === t.id && !prefs.themeCustomColor
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => pickTheme(t.id)}
                      title={t.name}
                      aria-pressed={active}
                      className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-all"
                      style={{
                        borderColor: active ? t.accent : 'var(--line-strong)',
                        background: active ? 'color-mix(in srgb, ' + t.accent + ' 12%, transparent)' : 'var(--panel)',
                        color: active ? 'var(--text)' : 'var(--text-2)',
                      }}
                    >
                      <span className="h-4 w-4 rounded-full" style={{ background: t.accent, boxShadow: active ? `0 0 0 3px color-mix(in srgb, ${t.accent} 30%, transparent)` : 'none' }} />
                      {t.name}
                    </button>
                  )
                })}
              </div>
            </FieldGroup>
          </StepShell>
        )}

        {step === 1 && (
          <StepShell title="Connection & permissions" subtitle="Pulse is in your server — here’s its health. Fix any gaps before turning features on.">
            <div className="rounded-xl border p-1.5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <HealthRow ok={perms?.inGuild ?? false} label="Pulse bot connected" hint={perms?.inGuild ? 'The bot is in this server.' : 'The bot isn’t responding — re-invite it below.'} />
              {perms === null ? (
                <HealthRow ok={null} label="Bot permissions" hint="Couldn’t verify right now — Discord will enforce at runtime." />
              ) : (
                <>
                  <HealthRow ok={perms.administrator || perms.sendMessages} label="Send messages" hint="Needed for welcome messages & alerts." />
                  <HealthRow ok={perms.administrator || perms.manageRoles} label="Manage roles" hint="Needed for auto roles." />
                  <HealthRow ok={perms.administrator || perms.moderateMembers} label="Moderate members" hint="Needed for timeouts." />
                  <HealthRow ok={perms.administrator || perms.manageMessages} label="Manage messages" hint="Needed for message cleanup." last />
                </>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2.5">
              <a
                href={botInviteUrl(guildId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              >
                <ExternalLink size={14} /> Re-invite with permissions
              </a>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              >
                <RefreshCw size={14} /> Re-check
              </button>
            </div>

            <FieldGroup label="Primary channels & role" className="mt-7">
              <div className="space-y-3">
                <Select label="Welcome & announcements channel" value={welcomeChannelId} onChange={setWelcomeChannelId} options={channels.map(channelOpt)} />
                <Select label="Moderation alerts channel" value={modChannelId} onChange={setModChannelId} options={channels.map(channelOpt)} />
                <Select label="Auto-role for new members" value={autoRoleId} onChange={setAutoRoleId} options={[{ value: '', label: 'No auto-role' }, ...roles.map((r) => ({ value: r.id, label: r.name }))]} />
              </div>
            </FieldGroup>
          </StepShell>
        )}

        {step === 2 && (
          <StepShell title="Turn on features" subtitle="We’ve pre-selected what most servers like yours use. Toggle anything off, or tweak the details.">
            <div className="space-y-3">
              {FEATURE_TEMPLATES.map((f) => {
                const on = features[f.key]
                const recommended = recommendedFeatures(selections)[f.key]
                return (
                  <FeatureCard
                    key={f.key}
                    icon={f.icon}
                    accent={f.accent}
                    label={f.label}
                    desc={f.desc}
                    recommended={recommended}
                    on={on}
                    onToggle={() => setFeatures((prev) => ({ ...prev, [f.key]: !prev[f.key] }))}
                  >
                    {on && f.key === 'welcome' && (
                      <div className="space-y-2.5">
                        <Select label="Channel" value={welcomeChannelId} onChange={setWelcomeChannelId} options={channels.map(channelOpt)} />
                        <div>
                          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-3)' }}>Message</label>
                          <textarea
                            value={welcomeMessage}
                            onChange={(e) => { setWelcomeMessage(e.target.value); setWelcomeEdited(true) }}
                            rows={2}
                            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                          />
                          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>Use {'{user}'} and {'{server}'} as placeholders.</p>
                        </div>
                      </div>
                    )}
                    {on && f.key === 'auto_role' && (
                      autoRoleId
                        ? <Select label="Role" value={autoRoleId} onChange={setAutoRoleId} options={roles.map((r) => ({ value: r.id, label: r.name }))} />
                        : <InlineWarn text="Pick an auto-role on the previous step, or this will be skipped." />
                    )}
                    {on && f.key === 'moderation' && (
                      <Select label="Alert channel" value={modChannelId} onChange={setModChannelId} options={channels.map(channelOpt)} />
                    )}
                    {on && f.key === 'pulse_guard' && (
                      <Select
                        label="Sensitivity"
                        value={guardSensitivity}
                        onChange={(v) => setGuardSensitivity(v as ModSensitivity)}
                        options={[
                          { value: 'low', label: 'Low — flag only' },
                          { value: 'medium', label: 'Medium — recommended' },
                          { value: 'aggressive', label: 'Aggressive — auto-act' },
                        ]}
                      />
                    )}
                    {on && f.key === 'analytics' && (
                      <p className="text-xs" style={{ color: 'var(--text-3)' }}>Analytics is always on — find it under Overview & Statistics.</p>
                    )}
                  </FeatureCard>
                )
              })}
            </div>
          </StepShell>
        )}

        {step === 3 && (
          <StepShell title="Review & finish" subtitle="Here’s everything we’ll set up. Finish to apply it to your server.">
            <div className="space-y-2.5">
              <ReviewRow on={features.welcome} label="Welcome system" detail={features.welcome ? `Posts to ${channelName(channels, welcomeChannelId)}` : undefined} />
              <ReviewRow on={features.auto_role && !!autoRoleId} label="Auto roles" detail={features.auto_role && autoRoleId ? `Assigns ${roleName(roles, autoRoleId)}` : features.auto_role ? 'No role selected — will be skipped' : undefined} />
              <ReviewRow on={features.moderation} label="Moderation alerts" detail={features.moderation ? `Posts to ${channelName(channels, modChannelId)}` : undefined} />
              <ReviewRow on={features.pulse_guard} label="Pulse Guard" detail={features.pulse_guard ? `AI moderation · ${guardSensitivity} sensitivity` : undefined} />
              <ReviewRow on={features.analytics} label="Analytics" detail={features.analytics ? 'Live insights — always on' : undefined} />
            </div>

            {perms && !perms.administrator && (!perms.sendMessages || !perms.manageRoles) && (
              <InlineWarn className="mt-4" text="Some bot permissions are missing — affected features will save but may not run until you re-invite Pulse." />
            )}

            {error && (
              <p className="mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
              </p>
            )}
          </StepShell>
        )}
      </div>

      {/* Nav */}
      <div className="mt-8 flex items-center justify-between border-t pt-5" style={{ borderColor: 'var(--line-strong)' }}>
        <button
          type="button"
          onClick={goBack}
          disabled={step === 0 || busy}
          className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all active:translate-y-px disabled:opacity-60"
          style={{ background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)', boxShadow: '0 6px 20px -6px var(--p-glow)' }}
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {step === last ? 'Finish setup' : 'Continue'}
          {!busy && step !== last && <ArrowRight size={16} />}
        </button>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center">
      {ONBOARDING_STEPS.map((s, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={s.id} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors"
                style={{
                  background: done ? 'var(--p-1)' : active ? 'var(--p-soft)' : 'var(--panel)',
                  borderColor: done || active ? 'var(--p-1)' : 'var(--line-strong)',
                  color: done ? '#fff' : active ? 'var(--p-1)' : 'var(--text-3)',
                }}
              >
                {done ? <Check size={15} /> : <CIcon name={s.icon} size={15} />}
              </span>
              <span
                className="hidden text-sm font-medium sm:inline"
                style={{ color: active ? 'var(--text)' : 'var(--text-3)' }}
              >
                {s.title}
              </span>
            </div>
            {i < ONBOARDING_STEPS.length - 1 && (
              <span className="mx-2 h-px flex-1 sm:mx-3" style={{ background: done ? 'var(--p-1)' : 'var(--line-strong)' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function StepShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight text-foreground">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{subtitle}</p>
      <div className="mt-6 space-y-7">{children}</div>
    </div>
  )
}

function FieldGroup({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{label}</p>
      {children}
    </div>
  )
}

function CardGrid({ children, cols }: { children: React.ReactNode; cols?: 2 | 3 }) {
  const cls = cols === 3 ? 'sm:grid-cols-3' : cols === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'
  return <div className={`grid grid-cols-1 gap-2.5 ${cls}`}>{children}</div>
}

function OptionCard({ icon, label, desc, active, onClick }: { icon: string; label: string; desc: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all"
      style={{
        borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
        background: active ? 'var(--p-soft)' : 'var(--panel)',
      }}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: active ? 'var(--p-1)' : 'var(--bg-2)', color: active ? '#fff' : 'var(--text-2)' }}>
        <CIcon name={icon} size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{label}</span>
        <span className="block text-xs leading-snug" style={{ color: 'var(--text-3)' }}>{desc}</span>
      </span>
    </button>
  )
}

function FeatureCard({
  icon, accent, label, desc, recommended, on, onToggle, children,
}: {
  icon: string; accent: string; label: string; desc: string; recommended: boolean; on: boolean; onToggle: () => void; children?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border p-4 transition-colors" style={{ background: 'var(--panel)', borderColor: on ? 'var(--p-1)' : 'var(--line-strong)' }}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
          <CIcon name={icon} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{label}</h3>
            {recommended && (
              <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>Recommended</span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>{desc}</p>
        </div>
        <Toggle on={on} onClick={onToggle} />
      </div>
      {on && children && <div className="mt-3.5 border-t pt-3.5" style={{ borderColor: 'var(--line-strong)' }}>{children}</div>}
    </div>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
      style={{ background: on ? 'var(--p-1)' : 'var(--bg-2)', border: '1px solid var(--line-strong)' }}
    >
      <span className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-all" style={{ left: on ? 'calc(100% - 1.25rem)' : '0.2rem' }} />
    </button>
  )
}

function HealthRow({ ok, label, hint, last }: { ok: boolean | null; label: string; hint: string; last?: boolean }) {
  const color = ok === null ? 'var(--text-3)' : ok ? 'var(--green)' : '#f59e0b'
  return (
    <div className="flex items-start gap-3 px-3 py-2.5" style={!last ? { borderBottom: '1px solid var(--line-strong)' } : undefined}>
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
        {ok === null ? <AlertTriangle size={12} /> : ok ? <Check size={12} /> : <AlertTriangle size={12} />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>{hint}</p>
      </div>
    </div>
  )
}

function ReviewRow({ on, label, detail }: { on: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-4 py-3" style={{ background: on ? 'var(--bg-2)' : 'transparent', borderColor: 'var(--line-strong)', opacity: on ? 1 : 0.6 }}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: on ? 'color-mix(in srgb, var(--green) 16%, transparent)' : 'var(--bg-2)', color: on ? 'var(--green)' : 'var(--text-3)' }}>
        {on ? <Check size={13} /> : <X size={13} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {detail && <p className="text-xs" style={{ color: 'var(--text-3)' }}>{detail}</p>}
      </div>
      <span className="text-xs font-medium" style={{ color: on ? 'var(--green)' : 'var(--text-3)' }}>{on ? 'On' : 'Off'}</span>
    </div>
  )
}

function InlineWarn({ text, className }: { text: string; className?: string }) {
  return (
    <p className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${className ?? ''}`} style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}>
      <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {text}
    </p>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-3)' }}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
        style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
      >
        {options.length === 0 && <option value="">No options available</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function channelOpt(c: ChannelOpt): { value: string; label: string } {
  return { value: c.id, label: `${c.type === 2 ? '🔊' : '#'} ${c.name}` }
}
function channelName(channels: ChannelOpt[], id: string): string {
  const c = channels.find((x) => x.id === id)
  return c ? `#${c.name}` : 'a channel'
}
function roleName(roles: RoleOpt[], id: string): string {
  return roles.find((x) => x.id === id)?.name ?? 'a role'
}
