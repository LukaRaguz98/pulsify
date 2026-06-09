'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Radio, Power, CheckCircle2, AlertCircle, Info, Save, Eye, Sparkles, Activity, Repeat, Wrench, ShieldCheck, Megaphone } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import {
  validatePresenceDraft,
  type PresenceDraft,
  type PresenceVars,
  type PresencePreset,
} from '@/lib/presence'
import type { ChangelogRelease } from '@/lib/release-notes-types'
import { savePresenceConfig, setActivePresence, clearActivePresence } from '@/app/dashboard/[guildId]/presence/actions'
import { StatusActivitiesField, RotationScheduleField, MaintenanceField } from './PresenceEditor'
import { PresencePreview } from './PresencePreview'
import { PresencePresets } from './PresencePresets'
import { PublishChangelog } from './PublishChangelog'

type Props = {
  guildId: string
  guildName: string
  initialDraft: PresenceDraft
  lastUpdated: string | null
  activeGuildId: string | null
  canEdit: boolean
  operators: { id: string; name: string }[]
  previewVars: PresenceVars
  releases: ChangelogRelease[]
  channels: { id: string; name: string }[]
}

export function PresenceContent({
  guildId,
  guildName,
  initialDraft,
  lastUpdated,
  activeGuildId,
  canEdit,
  operators,
  previewVars,
  releases,
  channels,
}: Props) {
  const router = useRouter()
  const [draft, setDraft] = useState<PresenceDraft>(initialDraft)
  const [saved, setSaved] = useState<PresenceDraft>(initialDraft)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Locale/timezone-dependent date formatting must happen client-side only —
  // rendering it during SSR mismatches the browser's locale and breaks
  // hydration. Render nothing until mounted, then fill in the formatted date.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isActive = activeGuildId === guildId
  const otherActive = activeGuildId !== null && activeGuildId !== guildId
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  const flash = (msg: string) => {
    setSuccess(msg)
    setError(null)
    setTimeout(() => setSuccess(null), 3500)
  }

  const update = (next: PresenceDraft) => {
    setDraft(next)
    setError(null)
  }

  const applyPreset = (preset: PresencePreset) => {
    update({ ...draft, ...preset.apply })
  }

  const onSave = () => {
    const validationError = validatePresenceDraft(draft)
    if (validationError) {
      setError(validationError)
      return
    }
    startTransition(async () => {
      const res = await savePresenceConfig(guildId, draft)
      if (res.ok) {
        setSaved(draft)
        flash('Presence saved.')
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  const onSetActive = () => {
    startTransition(async () => {
      const res = await setActivePresence(guildId)
      if (res.ok) {
        flash('This server now drives Pulse’s presence.')
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  const onClearActive = () => {
    startTransition(async () => {
      const res = await clearActivePresence(guildId)
      if (res.ok) {
        flash('Reverted Pulse to its default presence.')
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  const disabled = !canEdit || pending

  return (
    <div className="page-content">
      <PageHeader
        title="Presence"
        helpId="presence"
        description="Customize Pulse's Discord status, rotating activities and dynamic placeholders."
        action={
          isActive ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold"
              style={{ background: 'var(--p-soft)', color: 'var(--p-1)', borderColor: 'var(--p-1)' }}
            >
              <Radio size={12} /> Driving presence
            </span>
          ) : undefined
        }
      />

      {/* Bot-wide notice + who can see/manage this surface. */}
      <div
        className="mb-6 flex items-start gap-2.5 rounded-xl border p-3.5 text-sm"
        style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
      >
        <Info size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--p-1)' }} />
        <div className="space-y-2">
          <p>
            Pulse has a single <strong className="text-foreground">bot-wide</strong> presence. Each server builds its own config
            here, but only the <strong className="text-foreground">active</strong> server drives what everyone sees. Setting this
            server active replaces whatever was showing before.
          </p>
          <p className="flex flex-wrap items-center gap-1.5">
            <ShieldCheck size={13} className="shrink-0" style={{ color: 'var(--p-1)' }} />
            <span>Visible &amp; editable only to Pulsify {operators.length === 1 ? 'operator' : 'operators'}:</span>
            {operators.length === 0 ? (
              <span style={{ color: 'var(--text-3)' }}>none configured</span>
            ) : (
              operators.map((op) => (
                <span
                  key={op.id}
                  className="rounded-md border px-1.5 py-0.5 text-xs font-medium text-foreground"
                  style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
                >
                  {op.name}
                </span>
              ))
            )}
          </p>
        </div>
      </div>

      {/* Transient status banners */}
      {error && (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm"
          style={{ background: 'color-mix(in srgb, #f23f43 10%, transparent)', borderColor: '#f23f43', color: '#f23f43' }}
        >
          <AlertCircle size={15} /> {error}
        </div>
      )}
      {success && (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm"
          style={{ background: 'color-mix(in srgb, #23a55a 12%, transparent)', borderColor: '#23a55a', color: '#23a55a' }}
        >
          <CheckCircle2 size={15} /> {success}
        </div>
      )}

      <div className="space-y-8">
        {/* Live preview + active control — on top, as requested. */}
        <CategorySection
          icon={<Eye size={14} />}
          title="Live preview"
          description="What Pulse shows in Discord, and which server drives it."
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <PresencePreview draft={draft} vars={previewVars} botName="Pulse" />
              <p className="mt-3 text-[11px]" style={{ color: 'var(--text-3)' }}>
                Counts use this server&apos;s live values; <code>{'{servers}'}</code> is bot-wide.
              </p>
            </div>

            {/* Active control + save */}
            <div className="flex flex-col gap-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              {isActive ? (
                <>
                  <p className="text-sm font-medium text-foreground">This server is driving the presence.</p>
                  <button
                    type="button"
                    onClick={onClearActive}
                    disabled={disabled}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                    style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                  >
                    <Power size={14} /> Revert to default
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm" style={{ color: 'var(--text-2)' }}>
                    {otherActive
                      ? 'Another server is currently driving the presence. Setting this one active will take over.'
                      : `Make Pulse use ${guildName || 'this server'}’s presence config across all servers.`}
                  </p>
                  <button
                    type="button"
                    onClick={onSetActive}
                    disabled={disabled}
                    className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all disabled:opacity-50"
                    style={{ background: 'var(--p-1)' }}
                  >
                    <Radio size={14} /> Set as active presence
                  </button>
                </>
              )}

              <div className="mt-1 border-t pt-3" style={{ borderColor: 'var(--line-strong)' }}>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={disabled || !dirty}
                  className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-50"
                  style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 12px 30px -12px var(--p-glow)' }}
                >
                  {pending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {dirty ? 'Save changes' : 'Saved'}
                </button>
                {lastUpdated && mounted && (
                  <p className="mt-2 text-center text-[11px]" style={{ color: 'var(--text-3)' }} suppressHydrationWarning>
                    Last saved {new Date(lastUpdated).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          </div>
        </CategorySection>

        {/* Publish changelog — post the /changelog embed to a channel. */}
        <CategorySection
          icon={<Megaphone size={14} />}
          title="Publish changelog"
          description="Announce a release to a server channel — the same /changelog embed, no slash command shown."
        >
          <PublishChangelog guildId={guildId} releases={releases} channels={channels} disabled={!canEdit} />
        </CategorySection>

        {/* Quick presets — full width. */}
        <CategorySection
          icon={<Sparkles size={14} />}
          title="Quick presets"
          description="Start from a template, then tweak."
        >
          <PresencePresets disabled={disabled} onApply={applyPreset} />
        </CategorySection>

        {/* Status & activities — full width. */}
        <CategorySection
          icon={<Activity size={14} />}
          title="Status & activities"
          description="Pulse's status dot and the activities it shows or rotates through."
        >
          <StatusActivitiesField draft={draft} setDraft={update} disabled={disabled} />
        </CategorySection>

        {/* Rotation & schedule — full width. */}
        <CategorySection
          icon={<Repeat size={14} />}
          title="Rotation & schedule"
          helpId="presence-rotation"
          description="How fast activities cycle, and time-based status overrides."
        >
          <RotationScheduleField draft={draft} setDraft={update} disabled={disabled} />
        </CategorySection>

        {/* Maintenance — full width. */}
        <CategorySection
          icon={<Wrench size={14} />}
          title="Maintenance"
          description="Signal downtime with a Do-Not-Disturb status."
        >
          <MaintenanceField draft={draft} setDraft={update} disabled={disabled} />
        </CategorySection>
      </div>
    </div>
  )
}
