'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Coins,
  AlertCircle,
  ArrowLeft,
  X,
  MessageSquare,
  Mic,
  Terminal,
  Smile,
  CalendarCheck,
  HeartHandshake,
  CalendarDays,
  Gift,
  UserPlus,
  Trophy,
  Flame,
  Gauge,
  ShieldAlert,
  Bell,
  Hash,
  Ban,
  Sparkles,
  Calculator,
  BarChart3,
  Plus,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { SaveBar } from '@/components/ui/save-bar'
import { formatCoins } from '@/lib/economy'
import {
  type RewardConfig,
  type RewardCategory,
  type StreakMilestone,
  simulateReward,
  baseAmountFor,
} from '@/lib/economy-rewards'
import { type Timeframe } from '@/lib/analytics'
import { saveRewardSettings } from '@/app/dashboard/[guildId]/(management)/economy-earning/actions'

type Option = { id: string; name: string; color?: number }
type Props = {
  guildId: string
  guildName: string
  initialConfig: RewardConfig
  channels: Option[]
  roles: Option[]
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

export function EarningContent({ guildId, guildName, initialConfig, channels, roles }: Props) {
  const [config, setConfig] = useState<RewardConfig>(initialConfig)
  const [snapshot, setSnapshot] = useState<RewardConfig>(initialConfig)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Structural-clone update so nested edits stay immutable without deep-merge boilerplate. */
  function update(producer: (draft: RewardConfig) => void) {
    setConfig((c) => {
      const next = structuredClone(c)
      producer(next)
      return next
    })
  }

  const changedCount = useMemo(() => {
    let n = 0
    for (const k of Object.keys(snapshot) as (keyof RewardConfig)[]) {
      if (JSON.stringify(snapshot[k]) !== JSON.stringify(config[k])) n += 1
    }
    return n
  }, [snapshot, config])
  const dirty = changedCount > 0

  function handleReset() {
    setConfig(snapshot)
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await saveRewardSettings(guildId, config)
    if (res.ok) setSnapshot(config)
    else setError(res.error)
    setSaving(false)
  }

  const [tab, setTab] = useState<'sources' | 'rules'>('sources')
  const disabled = !config.enabled

  return (
    <div className="page-content">
      <PageHeader
        title="Earnings settings"
        helpId="economy-earning"
        description={
          <>
            Configure how members earn the Pulse Coins they spend on rewards in{' '}
            <span className="font-medium text-foreground">{guildName}</span>
          </>
        }
        action={
          <Link
            href={`/dashboard/${guildId}/economy`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <ArrowLeft size={12} />
            Back to Economy
          </Link>
        }
      />

      {error && (
        <div
          className="mb-6 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="space-y-6">
        {/* Master switch — prominent header card */}
        <div
          className="flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between"
          style={{ background: 'var(--panel)', borderColor: config.enabled ? 'var(--p-soft)' : 'var(--line-strong)' }}
        >
          <div className="flex items-start gap-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
              <Coins size={18} />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">Pulse Coin earning</p>
              <p className="mt-0.5 max-w-xl text-xs text-subtle">
                Master switch for how members earn on <span className="font-medium text-foreground">{guildName}</span>. Reputation is never granted — it stays a computed trust score, used here only as an optional multiplier.
              </p>
            </div>
          </div>
          <MiniToggle checked={config.enabled} onChange={(v) => update((d) => { d.enabled = v })} />
        </div>

        {/* Thematic sub-tabs: WHAT pays out vs HOW it's tuned/measured. */}
        <div className="inline-flex gap-1 rounded-xl border p-1" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          <TabButton active={tab === 'sources'} onClick={() => setTab('sources')} icon={<Coins size={14} />} label="Earning sources" />
          <TabButton active={tab === 'rules'} onClick={() => setTab('rules')} icon={<Gauge size={14} />} label="Rules & insights" />
        </div>

        {tab === 'sources' && (
        <div className="space-y-8">
        {/* Activity */}
        <CategorySection icon={<MessageSquare size={14} />} title="Activity rewards" description="Coins for taking part — chatting, voice, reactions and showing up.">
          <div className="grid gap-3 lg:grid-cols-2">
            <RateLimitedCard icon={<MessageSquare size={14} />} label="Messages sent" hint="Per message (with a cooldown)." disabled={disabled}
              src={config.activity.message} onChange={(p) => update((d) => Object.assign(d.activity.message, p))} />
            <RateLimitedCard icon={<Mic size={14} />} label="Voice activity" hint="Per minute in a voice channel with company." disabled={disabled}
              src={config.activity.voice} onChange={(p) => update((d) => Object.assign(d.activity.voice, p))} />
            <RateLimitedCard icon={<Terminal size={14} />} label="Command use" hint="Per slash command run." disabled={disabled}
              src={config.activity.command} onChange={(p) => update((d) => Object.assign(d.activity.command, p))} />
            <RateLimitedCard icon={<Smile size={14} />} label="Reactions received" hint="When others react to a member's message." disabled={disabled}
              src={config.activity.reaction} onChange={(p) => update((d) => Object.assign(d.activity.reaction, p))} />
            <FlatCard icon={<CalendarCheck size={14} />} label="Active day" hint="A one-off bonus the first time a member is active each day." disabled={disabled}
              src={config.activity.activeDay} onChange={(p) => update((d) => Object.assign(d.activity.activeDay, p))} />
            <FlatCard icon={<HeartHandshake size={14} />} label="Helpful contribution" hint="When a member resolves a support ticket." disabled={disabled}
              src={config.activity.helpful} onChange={(p) => update((d) => Object.assign(d.activity.helpful, p))} />
          </div>
        </CategorySection>

        {/* Events */}
        <CategorySection icon={<CalendarDays size={14} />} title="Event rewards" description="Reward members for taking part in scheduled events.">
          <div className="grid gap-3 lg:grid-cols-2">
            <FlatCard label="Event interest" hint="Marks interest in (RSVPs to) an event." disabled={disabled}
              src={config.event.participation} onChange={(p) => update((d) => Object.assign(d.event.participation, p))} />
            <FlatCard label="Event attendance" hint="In the event channel when it goes live." disabled={disabled}
              src={config.event.attendance} onChange={(p) => update((d) => Object.assign(d.event.attendance, p))} />
            <FlatCard label="Event completion" hint="Interested members, when the event ends." disabled={disabled}
              src={config.event.completion} onChange={(p) => update((d) => Object.assign(d.event.completion, p))} />
            <FlatCard label="Event hosting" hint="The member who created the event." disabled={disabled}
              src={config.event.hosting} onChange={(p) => update((d) => Object.assign(d.event.hosting, p))} />
          </div>
        </CategorySection>

        {/* Giveaways */}
        <CategorySection icon={<Gift size={14} />} title="Giveaway rewards" description="Reward entries, wins and hosting. The multiplier scales every giveaway payout.">
          <div className="mb-3">
            <NumberField icon={<Gauge size={14} />} label="Giveaway reward multiplier" value={config.giveaway.multiplier}
              onChange={(v) => update((d) => { d.giveaway.multiplier = v })} min={1} max={10} step={0.1} suffix="×" disabled={disabled} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <FlatCard label="Giveaway entry" hint="Joining a giveaway." disabled={disabled}
              src={config.giveaway.participation} onChange={(p) => update((d) => Object.assign(d.giveaway.participation, p))} />
            <FlatCard label="Giveaway win" hint="Winning a giveaway." disabled={disabled}
              src={config.giveaway.win} onChange={(p) => update((d) => Object.assign(d.giveaway.win, p))} />
            <FlatCard label="Giveaway hosting" hint="Creating a giveaway (paid when it ends)." disabled={disabled}
              src={config.giveaway.hosting} onChange={(p) => update((d) => Object.assign(d.giveaway.hosting, p))} />
          </div>
        </CategorySection>

        {/* Onboarding */}
        <CategorySection icon={<UserPlus size={14} />} title="Onboarding rewards" description="Encourage members to complete onboarding properly.">
          <div className="grid gap-3 lg:grid-cols-2">
            <FlatCard label="Onboarding complete" hint="Finishing the onboarding panel." disabled={disabled}
              src={config.onboarding.completion} onChange={(p) => update((d) => Object.assign(d.onboarding.completion, p))} />
            <FlatCard label="Profile complete" hint="Reserved — granted via future profile checks." disabled={disabled}
              src={config.onboarding.profile} onChange={(p) => update((d) => Object.assign(d.onboarding.profile, p))} />
            <FlatCard label="Verification" hint="Passing verification." disabled={disabled}
              src={config.onboarding.verification} onChange={(p) => update((d) => Object.assign(d.onboarding.verification, p))} />
            <FlatCard label="Role selection" hint="Picking at least one self-assignable role." disabled={disabled}
              src={config.onboarding.roleSelection} onChange={(p) => update((d) => Object.assign(d.onboarding.roleSelection, p))} />
          </div>
        </CategorySection>

        {/* Progression */}
        <CategorySection icon={<Trophy size={14} />} title="Progression rewards" description="Coins for levelling up and reaching milestones.">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', opacity: disabled ? 0.55 : 1 }}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Trophy size={14} /> Level up</p>
                <MiniToggle checked={config.progression.levelUp.enabled} disabled={disabled} onChange={(v) => update((d) => { d.progression.levelUp.enabled = v })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Base" value={config.progression.levelUp.base} onChange={(v) => update((d) => { d.progression.levelUp.base = v })} min={0} max={1000000} disabled={disabled} />
                <NumberField label="Per level" value={config.progression.levelUp.perLevel} onChange={(v) => update((d) => { d.progression.levelUp.perLevel = v })} min={0} max={1000000} disabled={disabled} />
              </div>
              <p className="mt-2 text-[11px] text-subtle">
                At level 10 ≈ <span className="font-mono text-foreground">{formatCoins(baseAmountFor(config, 'progression', 'levelUp', 10).base)}</span> coins
              </p>
            </div>
            <FlatCard icon={<Trophy size={14} />} label="Milestone reached" hint="Crossing a recognition milestone." disabled={disabled}
              src={config.progression.milestone} onChange={(p) => update((d) => Object.assign(d.progression.milestone, p))} />
          </div>
        </CategorySection>

        {/* Daily & weekly */}
        <CategorySection icon={<Flame size={14} />} title="Daily & weekly rewards" helpId="economy-streaks" description="Claimable coin rewards with growing streaks and loyalty milestones (/daily, /weekly).">
          <div className="grid gap-4 lg:grid-cols-2">
            <StreakCard label="Daily reward" unit="day" disabled={disabled} streak={config.daily}
              onChange={(p) => update((d) => Object.assign(d.daily, p))}
              onMilestones={(m) => update((d) => { d.daily.milestones = m })} />
            <StreakCard label="Weekly reward" unit="week" disabled={disabled} streak={config.weekly}
              onChange={(p) => update((d) => Object.assign(d.weekly, p))}
              onMilestones={(m) => update((d) => { d.weekly.milestones = m })} />
          </div>
        </CategorySection>
        </div>
        )}

        {tab === 'rules' && (
        <div className="space-y-8">
        {/* Multipliers */}
        <CategorySection icon={<Gauge size={14} />} title="Multipliers & bonuses" helpId="economy-multipliers" description="Scale payouts for trusted, boosting or premium members — and run limited-time seasonal boosts. Multipliers stack (capped at 10×).">
          <div className="space-y-3">
            <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', opacity: disabled ? 0.55 : 1 }}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Reputation multiplier</p>
                  <p className="mt-0.5 text-xs text-subtle">Higher computed trust earns more. Bonus scales from 0 at reputation 0 to the max at 100.</p>
                </div>
                <MiniToggle checked={config.multipliers.reputation.enabled} disabled={disabled} onChange={(v) => update((d) => { d.multipliers.reputation.enabled = v })} />
              </div>
              <div className="max-w-[200px]">
                <NumberField label="Max bonus at reputation 100" value={config.multipliers.reputation.maxBonusPct} onChange={(v) => update((d) => { d.multipliers.reputation.maxBonusPct = v })} min={0} max={500} suffix="%" disabled={disabled || !config.multipliers.reputation.enabled} />
              </div>
            </div>

            <MultiplierCard label="Event multiplier" hint="Applies on top of event-category payouts." disabled={disabled}
              m={config.multipliers.event} onChange={(p) => update((d) => Object.assign(d.multipliers.event, p))} />
            <MultiplierCard label="Server booster multiplier" hint="Members boosting this server earn more." disabled={disabled}
              m={config.multipliers.booster} onChange={(p) => update((d) => Object.assign(d.multipliers.booster, p))} />
            <MultiplierCard label="Premium multiplier" hint="Active when the server owner holds a paid Pulsify plan." disabled={disabled}
              m={config.multipliers.premium} onChange={(p) => update((d) => Object.assign(d.multipliers.premium, p))} />

            <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', opacity: disabled ? 0.55 : 1 }}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Sparkles size={14} /> Seasonal multiplier</p>
                  <p className="mt-0.5 text-xs text-subtle">A time-boxed boost for everyone (e.g. a double-coins weekend).</p>
                </div>
                <MiniToggle checked={config.multipliers.seasonal.enabled} disabled={disabled} onChange={(v) => update((d) => { d.multipliers.seasonal.enabled = v })} />
              </div>
              {config.multipliers.seasonal.enabled && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <NumberField label="Multiplier" value={config.multipliers.seasonal.value} onChange={(v) => update((d) => { d.multipliers.seasonal.value = v })} min={1} max={10} step={0.1} suffix="×" disabled={disabled} />
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Label</label>
                    <input type="text" value={config.multipliers.seasonal.label} maxLength={60} placeholder="Double XP weekend"
                      onChange={(e) => update((d) => { d.multipliers.seasonal.label = e.target.value })}
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle} />
                  </div>
                  <DateField label="Starts" value={config.multipliers.seasonal.startsAt} onChange={(v) => update((d) => { d.multipliers.seasonal.startsAt = v })} />
                  <DateField label="Ends" value={config.multipliers.seasonal.endsAt} onChange={(v) => update((d) => { d.multipliers.seasonal.endsAt = v })} />
                </div>
              )}
            </div>
          </div>
        </CategorySection>

        {/* Anti-abuse */}
        <CategorySection icon={<ShieldAlert size={14} />} title="Anti-abuse protection" helpId="economy-antiabuse" description="Keep the economy healthy: ignore channels/roles, gate brand-new accounts and cap how much a member can farm per day.">
          <div className="grid gap-5 lg:grid-cols-2">
            <TokenMultiSelect icon={<Hash size={14} />} label="Ignored channels" options={channels} selected={config.antiAbuse.ignoredChannelIds}
              onChange={(ids) => update((d) => { d.antiAbuse.ignoredChannelIds = ids })} emptyHint="No ignored channels." />
            <TokenMultiSelect icon={<Ban size={14} />} label="Ignored roles" options={roles} selected={config.antiAbuse.ignoredRoleIds}
              onChange={(ids) => update((d) => { d.antiAbuse.ignoredRoleIds = ids })} emptyHint="No ignored roles." />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <NumberField label="Minimum account age" value={config.antiAbuse.minAccountAgeDays} onChange={(v) => update((d) => { d.antiAbuse.minAccountAgeDays = v })} min={0} max={365} suffix="days" disabled={disabled} />
            <NumberField label="Global daily cap (per member)" value={config.antiAbuse.globalDailyCap} onChange={(v) => update((d) => { d.antiAbuse.globalDailyCap = v })} min={0} max={10000000} suffix="coins" disabled={disabled} />
          </div>
          <p className="mt-2 text-[11px] text-subtle">A cap of 0 means unlimited. Per-source cooldowns &amp; caps are set on each activity card above.</p>
        </CategorySection>

        {/* Notifications */}
        <CategorySection icon={<Bell size={14} />} title="Notifications" description="How members hear about coins they earn. Daily/weekly claims always reply in-channel.">
          <Toggle label="DM members when they earn a reward" description="Sends a brief DM for non-activity rewards (events, giveaways, milestones, level-ups). High-frequency chat/voice earning is never DM'd."
            checked={config.notify.dm} onChange={(v) => update((d) => { d.notify.dm = v })} />
        </CategorySection>

        {/* Simulator */}
        <CategorySection icon={<Calculator size={14} />} title="Reward simulator" description="Preview what a member would earn for any source under the current configuration.">
          <Simulator config={config} />
        </CategorySection>

        {/* Analytics */}
        <CategorySection icon={<BarChart3 size={14} />} title="Economy generation" description="Coins minted by your reward sources, where they come from, and who earns the most.">
          <Analytics guildId={guildId} />
        </CategorySection>
        </div>
        )}

        <SaveBar
          dirty={dirty}
          changedCount={changedCount}
          saving={saving}
          saveLabel="Save settings"
          cleanText="All earnings settings saved."
          dirtyHintText="review and save to apply them."
          confirmTitle="Save earnings settings?"
          confirmDescription="These reward amounts, multipliers and anti-abuse rules take effect immediately."
          confirmLabel="Save settings"
          onReset={handleReset}
          onSave={handleSave}
        />
      </div>
    </div>
  )
}

// ── Source cards ───────────────────────────────────────────────────────────────

type RateLimited = { enabled: boolean; amount: number; cooldownSeconds: number; dailyCap: number }
type Flat = { enabled: boolean; amount: number }

function RateLimitedCard({ icon, label, hint, src, onChange, disabled }: {
  icon?: React.ReactNode; label: string; hint: string; src: RateLimited; onChange: (p: Partial<RateLimited>) => void; disabled: boolean
}) {
  const dim = disabled || !src.enabled
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', opacity: disabled ? 0.55 : 1 }}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">{icon}{label}</p>
          <p className="mt-0.5 text-xs text-subtle">{hint}</p>
        </div>
        <MiniToggle checked={src.enabled} disabled={disabled} onChange={(v) => onChange({ enabled: v })} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Coins" value={src.amount} onChange={(v) => onChange({ amount: v })} min={0} max={1000000} disabled={dim} />
        <NumberField label="Cooldown" value={src.cooldownSeconds} onChange={(v) => onChange({ cooldownSeconds: v })} min={0} max={86400} suffix="s" disabled={dim} />
        <NumberField label="Daily cap" value={src.dailyCap} onChange={(v) => onChange({ dailyCap: v })} min={0} max={10000000} disabled={dim} />
      </div>
    </div>
  )
}

function FlatCard({ icon, label, hint, src, onChange, disabled }: {
  icon?: React.ReactNode; label: string; hint: string; src: Flat; onChange: (p: Partial<Flat>) => void; disabled: boolean
}) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', opacity: disabled ? 0.55 : 1 }}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">{icon}{label}</p>
          <p className="mt-0.5 text-xs text-subtle">{hint}</p>
        </div>
        <MiniToggle checked={src.enabled} disabled={disabled} onChange={(v) => onChange({ enabled: v })} />
      </div>
      <div className="max-w-[140px]">
        <NumberField label="Coins" value={src.amount} onChange={(v) => onChange({ amount: v })} min={0} max={1000000} disabled={disabled || !src.enabled} />
      </div>
    </div>
  )
}

function MultiplierCard({ label, hint, m, onChange, disabled }: {
  label: string; hint: string; m: { enabled: boolean; value: number }; onChange: (p: Partial<{ enabled: boolean; value: number }>) => void; disabled: boolean
}) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', opacity: disabled ? 0.55 : 1 }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="mt-0.5 text-xs text-subtle">{hint}</p>
        </div>
        <div className="flex items-center gap-3">
          {m.enabled && (
            <div className="w-24">
              <NumberField label="" value={m.value} onChange={(v) => onChange({ value: v })} min={1} max={10} step={0.1} suffix="×" disabled={disabled} />
            </div>
          )}
          <MiniToggle checked={m.enabled} disabled={disabled} onChange={(v) => onChange({ enabled: v })} />
        </div>
      </div>
    </div>
  )
}

function StreakCard({ label, unit, streak, onChange, onMilestones, disabled }: {
  label: string; unit: string; streak: RewardConfig['daily']; onChange: (p: Partial<RewardConfig['daily']>) => void; onMilestones: (m: StreakMilestone[]) => void; disabled: boolean
}) {
  function addMilestone() {
    const next = streak.milestones.length ? Math.max(...streak.milestones.map((m) => m.streak)) + (unit === 'week' ? 4 : 7) : (unit === 'week' ? 4 : 7)
    onMilestones([...streak.milestones, { streak: next, bonus: 100 }])
  }
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', opacity: disabled ? 0.55 : 1 }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Flame size={14} />{label}</p>
        <MiniToggle checked={streak.enabled} disabled={disabled} onChange={(v) => onChange({ enabled: v })} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Base" value={streak.amount} onChange={(v) => onChange({ amount: v })} min={0} max={1000000} disabled={disabled || !streak.enabled} />
        <NumberField label={`Per-${unit} bonus`} value={streak.streakBonus} onChange={(v) => onChange({ streakBonus: v })} min={0} max={1000000} disabled={disabled || !streak.enabled} />
        <NumberField label="Bonus cap" value={streak.streakMax} onChange={(v) => onChange({ streakMax: v })} min={0} max={1000000} disabled={disabled || !streak.enabled} />
      </div>
      <p className="mt-3 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle">Loyalty milestones</p>
      <div className="space-y-1.5">
        {streak.milestones.length === 0 && <p className="text-xs text-subtle">No milestone bonuses.</p>}
        {streak.milestones.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-subtle">At</span>
            <input type="number" min={1} max={100000} value={m.streak} disabled={disabled || !streak.enabled}
              onChange={(e) => onMilestones(streak.milestones.map((x, idx) => idx === i ? { ...x, streak: Math.max(1, Number(e.target.value) || 1) } : x))}
              className="w-16 rounded-lg border px-2 py-1 text-sm focus:outline-none focus:ring-1" style={fieldStyle} />
            <span className="text-xs text-subtle">{unit}s →</span>
            <input type="number" min={1} max={1000000} value={m.bonus} disabled={disabled || !streak.enabled}
              onChange={(e) => onMilestones(streak.milestones.map((x, idx) => idx === i ? { ...x, bonus: Math.max(1, Number(e.target.value) || 1) } : x))}
              className="w-24 rounded-lg border px-2 py-1 text-sm focus:outline-none focus:ring-1" style={fieldStyle} />
            <span className="text-xs text-subtle">coins</span>
            <button onClick={() => onMilestones(streak.milestones.filter((_, idx) => idx !== i))} className="ml-auto rounded-md p-1 text-subtle hover:text-foreground"><X size={12} /></button>
          </div>
        ))}
      </div>
      <button onClick={addMilestone} disabled={disabled || !streak.enabled || streak.milestones.length >= 10}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-2)' }}>
        <Plus size={12} /> Add milestone
      </button>
    </div>
  )
}

// ── Simulator ──────────────────────────────────────────────────────────────────

const SIM_SOURCES: { category: RewardCategory; key: string; label: string }[] = [
  { category: 'activity', key: 'message', label: 'Message sent' },
  { category: 'activity', key: 'voice', label: 'Voice minute' },
  { category: 'activity', key: 'reaction', label: 'Reaction received' },
  { category: 'activity', key: 'activeDay', label: 'Active day' },
  { category: 'activity', key: 'helpful', label: 'Helpful contribution' },
  { category: 'event', key: 'attendance', label: 'Event attendance' },
  { category: 'event', key: 'hosting', label: 'Event hosting' },
  { category: 'giveaway', key: 'win', label: 'Giveaway win' },
  { category: 'onboarding', key: 'completion', label: 'Onboarding complete' },
  { category: 'progression', key: 'levelUp', label: 'Level up' },
  { category: 'progression', key: 'milestone', label: 'Milestone' },
  { category: 'daily', key: 'daily', label: 'Daily claim' },
  { category: 'daily', key: 'weekly', label: 'Weekly claim' },
]

function Simulator({ config }: { config: RewardConfig }) {
  const [idx, setIdx] = useState(0)
  const [reputation, setReputation] = useState(50)
  const [isBooster, setBooster] = useState(false)
  const [isPremium, setPremium] = useState(false)
  const [n, setN] = useState(10)

  const sel = SIM_SOURCES[idx]
  const needsN = sel.category === 'progression' && sel.key === 'levelUp' ? 'level' : sel.category === 'daily' ? 'streak' : null

  const result = useMemo(
    () => simulateReward(config, { category: sel.category, key: sel.key, n, reputation: config.multipliers.reputation.enabled ? reputation : null, isBooster, isPremium }),
    [config, sel, n, reputation, isBooster, isPremium],
  )

  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Reward source</label>
          <select value={idx} onChange={(e) => setIdx(Number(e.target.value))} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle}>
            {SIM_SOURCES.map((s, i) => <option key={`${s.category}:${s.key}`} value={i}>{s.label}</option>)}
          </select>
        </div>
        {needsN && (
          <NumberField label={needsN === 'level' ? 'Level' : 'Streak'} value={n} onChange={setN} min={1} max={1000} />
        )}
        {config.multipliers.reputation.enabled && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Reputation: {reputation}</label>
            <input type="range" min={0} max={100} value={reputation} onChange={(e) => setReputation(Number(e.target.value))} className="w-full" />
          </div>
        )}
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={isBooster} onChange={(e) => setBooster(e.target.checked)} /> Booster</label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={isPremium} onChange={(e) => setPremium(e.target.checked)} /> Premium</label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
        {!result.enabled ? (
          <p className="text-sm text-subtle">This source is currently disabled — a member would earn nothing.</p>
        ) : (
          <>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-subtle">Base</p>
              <p className="font-mono text-sm text-foreground">{formatCoins(result.base)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-subtle">Multiplier</p>
              <p className="font-mono text-sm text-foreground">{result.multiplier.toFixed(2)}×</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-[11px] uppercase tracking-wide text-subtle">Member earns</p>
              <p className="text-lg font-semibold" style={{ color: 'var(--p-1)' }}>{formatCoins(result.total)} coins</p>
            </div>
            {result.applied.length > 0 && (
              <div className="w-full border-t pt-2" style={{ borderColor: 'var(--line-strong)' }}>
                <span className="text-[11px] text-subtle">Active: </span>
                {result.applied.map((a) => (
                  <span key={a.key} className="mr-1.5 inline-block rounded px-1.5 py-0.5 text-[11px]" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>{a.label} {a.factor.toFixed(2)}×</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Analytics ──────────────────────────────────────────────────────────────────

type AnalyticsData = {
  generated: number
  distributed: number
  earners: number
  breakdown: { reason: string; label: string; category: string; amount: number; count: number }[]
  topEarners: { user_id: string; user_name: string | null; amount: number }[]
}
const TIMEFRAMES: Timeframe[] = ['24h', '7d', '30d', 'all']

function Analytics({ guildId }: { guildId: string }) {
  const [timeframe, setTimeframe] = useState<Timeframe>('30d')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/guilds/${guildId}/economy/rewards?timeframe=${timeframe}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (!cancelled) setData(j.analytics) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [guildId, timeframe])

  const max = data?.breakdown[0]?.amount ?? 0

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
        {TIMEFRAMES.map((tf) => (
          <button key={tf} onClick={() => setTimeframe(tf)}
            className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            style={tf === timeframe ? { background: 'var(--p-1)', color: '#fff' } : { color: 'var(--text-2)' }}>
            {tf === 'all' ? 'All time' : tf}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-subtle">Loading analytics…</p>
      ) : !data ? (
        <p className="text-sm text-subtle">Couldn’t load analytics.</p>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Stat label="Coins generated" value={formatCoins(data.generated)} />
            <Stat label="Rewards distributed" value={data.distributed.toLocaleString()} />
            <Stat label="Members earning" value={data.earners.toLocaleString()} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">Most valuable activities</p>
              {data.breakdown.length === 0 ? (
                <p className="text-sm text-subtle">No coins earned in this window yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.breakdown.map((b) => (
                    <div key={b.reason}>
                      <div className="mb-0.5 flex items-center justify-between text-xs">
                        <span className="text-foreground">{b.label}</span>
                        <span className="font-mono text-subtle">{formatCoins(b.amount)} · {b.count.toLocaleString()}×</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
                        <div className="h-full rounded-full" style={{ width: `${max ? Math.max(3, (b.amount / max) * 100) : 0}%`, background: 'var(--p-1)' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">Top earners</p>
              {data.topEarners.length === 0 ? (
                <p className="text-sm text-subtle">No earners in this window yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.topEarners.map((u, i) => (
                    <div key={u.user_id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
                      <span className="text-foreground">{i + 1}. {u.user_name ?? u.user_id}</span>
                      <span className="font-mono text-subtle">{formatCoins(u.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors"
      style={active ? { background: 'var(--p-1)', color: '#fff', boxShadow: '0 2px 8px -3px var(--p-glow)' } : { color: 'var(--text-2)' }}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <p className="text-xs text-subtle">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  )
}

// ── Inline field helpers (mirror LevelingSettingsContent) ────────────────────────

function NumberField({ label, value, onChange, min, max, step, suffix, icon, disabled }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string; icon?: React.ReactNode; disabled?: boolean
}) {
  return (
    <div>
      {label && (
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{icon}{label}</label>
      )}
      <div className="relative">
        <input type="number" value={value} min={min} max={max} step={step ?? 1} disabled={disabled}
          onChange={(e) => { const n = Number(e.target.value); onChange(Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min) }}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-50" style={fieldStyle} />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-subtle">{suffix}</span>}
      </div>
    </div>
  )
}

function DateField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  // datetime-local wants "YYYY-MM-DDTHH:mm"; store ISO.
  const local = value ? new Date(value).toISOString().slice(0, 16) : ''
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <input type="datetime-local" value={local} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle} />
    </div>
  )
}

function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
      </div>
      <MiniToggle checked={checked} onChange={onChange} />
    </div>
  )
}

function MiniToggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button onClick={() => !disabled && onChange(!checked)} disabled={disabled}
      className="relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50"
      style={{ background: checked ? 'var(--p-1)' : 'var(--line-strong)' }} role="switch" aria-checked={checked}>
      <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }} />
    </button>
  )
}

function TokenMultiSelect({ label, options, selected, onChange, emptyHint, icon }: {
  label: string; options: Option[]; selected: string[]; onChange: (ids: string[]) => void; emptyHint: string; icon?: React.ReactNode
}) {
  const byId = new Map(options.map((o) => [o.id, o]))
  const available = options.filter((o) => !selected.includes(o.id))
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{icon}{label}</label>
      {selected.length === 0 ? (
        <p className="mb-2 text-xs text-subtle">{emptyHint}</p>
      ) : (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>
              {byId.get(id)?.name ?? id}
              <button onClick={() => onChange(selected.filter((s) => s !== id))} className="opacity-60 hover:opacity-100"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <select value="" onChange={(e) => { if (e.target.value) onChange([...selected, e.target.value]) }} disabled={available.length === 0}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-50" style={fieldStyle}>
        <option value="">{available.length === 0 ? 'Nothing left to add' : 'Add…'}</option>
        {available.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  )
}