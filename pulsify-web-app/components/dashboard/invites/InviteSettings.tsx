'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, UserPlus, ShieldCheck, ShieldAlert, Bell, AlertCircle, CheckCircle2, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { SaveBar } from '@/components/ui/save-bar'
import { defaultInviteConfig, INVITE_LIMITS, type InviteConfig } from '@/lib/invites'
import { saveInviteSettings } from '@/app/dashboard/[guildId]/(management)/invites/actions'

type Channel = { id: string; name: string }

type Props = {
  guildId: string
  guildName: string
  config: InviteConfig
  channels: Channel[]
}

export function InviteSettings({ guildId, guildName, config, channels }: Props) {
  const router = useRouter()
  const [draft, setDraft] = useState<InviteConfig>(config)
  const [saving, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const set = <K extends keyof InviteConfig>(key: K, value: InviteConfig[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setSaved(false)
  }

  const changedCount = useMemo(() => {
    let n = 0
    for (const k of Object.keys(draft) as (keyof InviteConfig)[]) if (draft[k] !== config[k]) n++
    return n
  }, [draft, config])
  const dirty = changedCount > 0

  function handleReset() {
    setDraft(config)
  }
  function handleSave() {
    startTransition(async () => {
      const res = await saveInviteSettings(guildId, draft)
      if (res.ok) {
        setError(null)
        setSaved(true)
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Invite settings"
        helpId="invites"
        description={
          <>
            Configure invite tracking, valid-invite rules and anti-abuse for{' '}
            <span className="font-medium text-foreground">{guildName}</span>
          </>
        }
        action={
          <Link
            href={`/dashboard/${guildId}/invites`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <ArrowLeft size={12} />
            Back to Invites
          </Link>
        }
      />

      <div className="space-y-8 pb-24">
        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 opacity-70 hover:opacity-100"><X size={14} /></button>
          </div>
        )}
        {saved && !dirty && (
          <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.08)', color: '#34d399' }}>
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">Invite settings saved.</span>
          </div>
        )}

        <CategorySection icon={<UserPlus size={14} />} title="Invite tracking" description="Attribute joins to invites, score them and grant referral milestones for this server.">
          <Toggle label="Enable invite tracking" hint="Turn on tracking, scoring and anti-abuse. Referral rewards are created as milestones in Engagement › Milestones." checked={draft.enabled} onChange={(v) => set('enabled', v)} />
        </CategorySection>

        <CategorySection icon={<ShieldCheck size={14} />} title="Valid-invite rules" description="Decide what counts as a valid invite. Unmet time-based rules keep a join “pending” until satisfied.">
          <NumberField label="Minimum account age" suffix="days" hint="Reject accounts newer than this (0 = off)." value={draft.min_account_age_days} min={0} max={INVITE_LIMITS.maxAccountAgeDays} onChange={(v) => set('min_account_age_days', v)} />
          <NumberField label="Minimum stay" suffix="hours" hint="The member must remain this long to count (0 = off)." value={draft.min_stay_hours} min={0} max={INVITE_LIMITS.maxStayHours} onChange={(v) => set('min_stay_hours', v)} />
          <NumberField label="Minimum activity" suffix="messages" hint="The member must send this many messages (0 = off)." value={draft.min_activity_messages} min={0} max={INVITE_LIMITS.maxActivityMessages} onChange={(v) => set('min_activity_messages', v)} />
          <Toggle label="Require completed onboarding" checked={draft.require_onboarding} onChange={(v) => set('require_onboarding', v)} />
          <Toggle label="Require verification" checked={draft.require_verification} onChange={(v) => set('require_verification', v)} />
          <Toggle label="Require no active moderation flags" checked={draft.require_no_flags} onChange={(v) => set('require_no_flags', v)} />
          <Toggle label="Don’t count likely alt accounts" hint="Uses Safety › Alt Detection to exclude probable alts." checked={draft.exclude_alts} onChange={(v) => set('exclude_alts', v)} />
        </CategorySection>

        <CategorySection icon={<ShieldAlert size={14} />} title="Anti-abuse" description="Detect and block common invite-farming techniques.">
          <Toggle label="Block self-invites" checked={draft.block_self_invites} onChange={(v) => set('block_self_invites', v)} />
          <Toggle label="Block alt-account farming" hint="Mark joins from likely alts as fake." checked={draft.block_alt_farming} onChange={(v) => set('block_alt_farming', v)} />
          <NumberField label="Rapid-rejoin window" suffix="hours" hint="Rejoins within this window are treated as suspicious." value={draft.rejoin_window_hours} min={0} max={INVITE_LIMITS.maxRejoinWindowHours} onChange={(v) => set('rejoin_window_hours', v)} />
          <NumberField label="Max rejoins before fake" suffix="rejoins" hint="Mark a member fake after this many rejoins (0 = off)." value={draft.max_rejoins} min={0} max={INVITE_LIMITS.maxRejoins} onChange={(v) => set('max_rejoins', v)} />
          <NumberField label="Spike alert threshold" suffix="joins / hr" hint="Alert when one inviter drives this many joins in an hour (0 = off)." value={draft.spike_threshold} min={0} max={INVITE_LIMITS.maxSpike} onChange={(v) => set('spike_threshold', v)} />
        </CategorySection>

        <CategorySection icon={<Bell size={14} />} title="Notifications" description="Announce invite activity to a channel and choose which events fire.">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Announcement channel</span>
            <select
              value={draft.notify_channel_id ?? ''}
              onChange={(e) => set('notify_channel_id', e.target.value || null)}
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text)' }}
            >
              <option value="">No channel — dashboard notifications only</option>
              {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </label>
          <Toggle label="An invited member joins" checked={draft.notify_on_join} onChange={(v) => set('notify_on_join', v)} />
          <Toggle label="An invite becomes valid" checked={draft.notify_on_valid} onChange={(v) => set('notify_on_valid', v)} />
          <Toggle label="An invite is marked invalid or fake" checked={draft.notify_on_invalid} onChange={(v) => set('notify_on_invalid', v)} />
        </CategorySection>

        <div className="flex justify-end">
          <button type="button" onClick={() => setDraft(defaultInviteConfig())} className="text-xs font-medium text-subtle underline underline-offset-2 hover:text-foreground">
            Reset to defaults
          </button>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        changedCount={changedCount}
        saving={saving}
        saveLabel="Save settings"
        cleanText="All invite settings saved."
        dirtyHintText="review and save to apply them."
        confirmTitle="Save invite settings?"
        confirmDescription="Validity rules and anti-abuse take effect immediately."
        confirmLabel="Save settings"
        onReset={handleReset}
        onSave={handleSave}
      />
    </div>
  )
}

// ── Small controls ──────────────────────────────────────────────────────────

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-subtle">{hint}</div>}
      </div>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors" style={{ background: checked ? 'var(--p-1)' : 'var(--line-strong)' }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: checked ? '18px' : '2px' }} />
      </button>
    </div>
  )
}

function NumberField({ label, hint, suffix, value, min, max, onChange }: { label: string; hint?: string; suffix?: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-subtle">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
          className="w-20 rounded-lg border px-2 py-1.5 text-right text-sm outline-none"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text)' }}
        />
        {suffix && <span className="w-16 text-xs text-subtle">{suffix}</span>}
      </div>
    </div>
  )
}
