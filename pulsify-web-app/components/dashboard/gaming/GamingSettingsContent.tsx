'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  Eye,
  Gamepad2,
  ShieldCheck,
  Timer,
  Users,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { SaveBar } from '@/components/ui/save-bar'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { DEFAULT_GAMING_SETTINGS, type GamingSettings } from '@/lib/gaming'

/**
 * Gaming Analytics settings — the module's privacy contract with the server.
 *
 * The order of the page is deliberate: the master switch and the exclusions
 * come FIRST, before anything about presentation. This module records what
 * members are doing, so the page opens on the question of who is being
 * recorded rather than burying it under formatting options.
 *
 * Which gaming events actually notify you is NOT configured here — that lives
 * with every other module's alerts on Notification settings, under "Gaming".
 */

type Option = { id: string; name: string }
type OptOut = { user_id: string; purge_history: boolean; created_at: string }

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

/**
 * Retention presets rather than a free number box. The plan already caps how
 * far back Gaming can look; this setting only ever shortens it further, and
 * "keep 60 days of presence data" is a decision made from a shortlist, not by
 * typing 47.
 */
const RETENTION_OPTIONS: { value: number; label: string; hint: string }[] = [
  { value: 0, label: 'Plan maximum', hint: 'No extra limit' },
  { value: 30, label: '30 days', hint: 'A month back' },
  { value: 60, label: '60 days', hint: 'Two months' },
  { value: 90, label: '90 days', hint: 'A quarter' },
]

/** Same reasoning: a shortlist of sensible floors, not an arbitrary integer. */
const MIN_SESSION_OPTIONS: { value: number; label: string; hint: string }[] = [
  { value: 0, label: 'Count everything', hint: 'No floor' },
  { value: 60, label: '1 minute', hint: 'Skip the briefest' },
  { value: 120, label: '2 minutes', hint: 'Recommended' },
  { value: 300, label: '5 minutes', hint: 'Real sessions only' },
]

export function GamingSettingsContent({
  guildId,
  guildName,
  roles,
}: {
  guildId: string
  guildName: string
  roles: Option[]
}) {
  const [saved, setSaved] = useState<GamingSettings | null>(null)
  const [draft, setDraft] = useState<GamingSettings>(DEFAULT_GAMING_SETTINGS)
  const [optOuts, setOptOuts] = useState<OptOut[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/guilds/${guildId}/gaming/settings`, { cache: 'no-store' })
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(body.error ?? 'Settings could not be loaded.')
        setSaved(body.settings as GamingSettings)
        setDraft(body.settings as GamingSettings)
        setOptOuts((body.optOuts ?? []) as OptOut[])
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Settings could not be loaded.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [guildId])

  const changed = useMemo(() => {
    if (!saved) return 0
    return (Object.keys(draft) as (keyof GamingSettings)[]).filter(
      (k) => JSON.stringify(draft[k]) !== JSON.stringify(saved[k]),
    ).length
  }, [draft, saved])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/guilds/${guildId}/gaming/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Settings could not be saved.')
      setSaved(body.settings as GamingSettings)
      setDraft(body.settings as GamingSettings)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Settings could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const set = <K extends keyof GamingSettings>(key: K, value: GamingSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  if (loading && !saved) {
    return (
      <div className="page-content">
        <TableSkeleton rows={6} />
      </div>
    )
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Gaming settings"
        helpId="gaming-settings"
        description={
          <>
            What Pulse records from Discord presence in{' '}
            <span className="font-medium text-foreground">{guildName}</span>, and who is excluded.
          </>
        }
        action={
          <Link
            href={`/dashboard/${guildId}/gaming`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <ArrowLeft size={12} />
            Back to Gaming
          </Link>
        }
      />

      <div className="space-y-8">
        {error && (
          <div
            className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
            style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 opacity-70 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Master switch */}
        <CategorySection
          icon={<Gamepad2 size={14} />}
          title="Gaming tracking"
          description="Pulse reads Discord presence. Members who hide their activity in Discord are never visible to it in the first place."
          helpId="gaming-tracking"
        >
          <div className="space-y-3">
            <Toggle
              label="Record gaming sessions"
              description="Turning this off stops collection immediately. Existing history is kept and reappears if you turn it back on."
              checked={draft.enabled}
              onChange={(v) => set('enabled', v)}
            />
            <Toggle
              label="Count competitive activity"
              description='Discord reports ranked and competitive modes separately from "playing". Most servers want them counted; turn this off if it adds noise.'
              checked={draft.trackCompeting}
              onChange={(v) => set('trackCompeting', v)}
            />
          </div>
        </CategorySection>

        {/* Windows */}
        <CategorySection
          icon={<Clock size={14} />}
          title="History & session length"
          description="How far back Gaming looks, and how short a session can be before it stops counting."
        >
          <div className="space-y-5">
            <OptionCards
              label="Data retention"
              icon={<Clock size={14} />}
              hint="A privacy limit of your own, on top of your plan's analytics retention — it can only shorten the window, never extend it. Sessions are never deleted by this setting."
              options={RETENTION_OPTIONS}
              value={draft.retentionDays}
              onChange={(v) => set('retentionDays', v)}
            />
            <OptionCards
              label="Minimum session length"
              icon={<Timer size={14} />}
              hint="Anything shorter is discarded rather than stored — alt-tabbing through a launcher is not a play session. Changing this does not clean up existing history."
              options={MIN_SESSION_OPTIONS}
              value={draft.minSessionSeconds}
              onChange={(v) => set('minSessionSeconds', v)}
            />
          </div>
        </CategorySection>

        {/* Exclusions */}
        <CategorySection
          icon={<Users size={14} />}
          title="Exclusions"
          description="Anyone excluded here leaves no rows at all — the bot checks these before writing, not when reading."
          helpId="gaming-exclusions"
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <TokenMultiSelect
              label="Ignored roles"
              icon={<Users size={14} />}
              options={roles}
              selected={draft.ignoredRoles}
              onChange={(v) => set('ignoredRoles', v)}
              emptyHint="Every role is tracked."
            />
            <TokenList
              label="Ignored games"
              icon={<Gamepad2 size={14} />}
              placeholder="Wallpaper Engine"
              emptyHint="Every game is tracked."
              values={draft.ignoredGames}
              onChange={(v) => set('ignoredGames', v)}
            />
            <TokenList
              label="Ignored members"
              icon={<Users size={14} />}
              placeholder="Discord user ID"
              emptyHint="Every member is tracked."
              values={draft.ignoredMembers}
              onChange={(v) => set('ignoredMembers', v)}
            />
          </div>
        </CategorySection>

        {/* Privacy */}
        <CategorySection
          icon={<ShieldCheck size={14} />}
          title="Privacy"
          description="How much of what is collected is shown, and what members can decide for themselves. Members see a read-only version of Gaming — what the server plays, who's playing now and who to team up with — so these two settings decide what your community sees about each other, not just what you see."
          helpId="gaming-privacy"
        >
          <div className="space-y-3">
            <Toggle
              label="Anonymise statistics"
              description="Leaderboards, live activity and exports show members as “Player 1, 2, 3…” instead of by name — on your view and on the members' view alike. Rankings still work; identities do not leave the server."
              checked={draft.anonymizeStats}
              onChange={(v) => set('anonymizeStats', v)}
            />
            <Toggle
              label="Allow members to opt out"
              description="Offers /gaming opt-out in Discord. Opting out stops collection for that member and can delete what was already recorded."
              checked={draft.allowMemberOptOut}
              onChange={(v) => set('allowMemberOptOut', v)}
            />
          </div>

          {optOuts.length > 0 && (
            <div
              className="mt-4 rounded-xl border p-4"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
            >
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Eye size={14} />
                {optOuts.length} member{optOuts.length === 1 ? '' : 's'} opted out
              </p>
              <div className="flex flex-wrap gap-1.5">
                {optOuts.slice(0, 12).map((o) => (
                  <span
                    key={o.user_id}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                    style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                    title={o.purge_history ? 'History deleted' : 'History kept'}
                  >
                    {o.user_id}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-subtle">
                Opt-outs are the member’s own decision and can only be reversed by them, with
                /gaming opt-in.
              </p>
            </div>
          )}
        </CategorySection>

      </div>

      <SaveBar
        dirty={changed > 0}
        changedCount={changed}
        saving={saving}
        saveLabel="Save settings"
        confirmTitle="Save gaming settings?"
        confirmDescription={
          saved && draft.enabled !== saved.enabled
            ? draft.enabled
              ? 'Pulse will start recording play sessions from Discord presence for everyone who is not excluded.'
              : 'Pulse will stop recording play sessions. Existing history is kept and returns if you switch tracking back on.'
            : 'These take effect on the next presence update — no restart needed.'
        }
        onReset={() => saved && setDraft(saved)}
        onSave={() => void save()}
      />
    </div>
  )
}

// ── Small controls ──────────────────────────────────────────────────────────

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-xl border p-4"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200"
        style={{ background: checked ? 'var(--p-1)' : 'var(--line-strong)' }}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      >
        <span
          className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  )
}

/** Preset chooser — the card grid used by Levels & XP for its announce modes. */
function OptionCards({
  label,
  icon,
  hint,
  options,
  value,
  onChange,
}: {
  label: string
  icon?: React.ReactNode
  hint?: string
  options: { value: number; label: string; hint: string }[]
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map((o) => {
          const active = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className="rounded-xl border p-3 text-left transition"
              style={{
                borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                background: active ? 'var(--p-soft)' : 'var(--panel)',
              }}
            >
              <p
                className="text-sm font-semibold"
                style={{ color: active ? 'var(--p-1)' : 'var(--text)' }}
              >
                {o.label}
              </p>
              <p className="mt-0.5 text-[11px] text-subtle">{o.hint}</p>
            </button>
          )
        })}
      </div>
      {hint && <p className="mt-2 text-xs text-subtle">{hint}</p>}
    </div>
  )
}

/** Role picker — same shape as the Birthdays / Invites settings token pickers. */
function TokenMultiSelect({
  label,
  options,
  selected,
  onChange,
  emptyHint,
  icon,
}: {
  label: string
  options: Option[]
  selected: string[]
  onChange: (ids: string[]) => void
  emptyHint: string
  icon?: React.ReactNode
}) {
  const byId = new Map(options.map((o) => [o.id, o]))
  const available = options.filter((o) => !selected.includes(o.id))
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </label>
      {selected.length === 0 ? (
        <p className="mb-2 text-xs text-subtle">{emptyHint}</p>
      ) : (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
              style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
            >
              {byId.get(id)?.name ?? id}
              <button
                type="button"
                onClick={() => onChange(selected.filter((s) => s !== id))}
                className="opacity-60 hover:opacity-100"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) onChange([...selected, e.target.value])
        }}
        disabled={available.length === 0}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-50"
        style={fieldStyle}
      >
        <option value="">{available.length === 0 ? 'Nothing left to add' : 'Add…'}</option>
        {available.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Free-text variant of the same token picker, for values with no list to pick
 * from — a game name Discord reports, or a member ID. Entries are added on
 * Enter and removed by their ×, so the committed value is never ambiguous the
 * way a comma-separated text box is mid-typing.
 */
function TokenList({
  label,
  icon,
  placeholder,
  emptyHint,
  values,
  onChange,
}: {
  label: string
  icon?: React.ReactNode
  placeholder: string
  emptyHint: string
  values: string[]
  onChange: (v: string[]) => void
}) {
  const [text, setText] = useState('')

  function commit() {
    const entry = text.trim()
    if (!entry) return
    if (!values.includes(entry)) onChange([...values, entry])
    setText('')
  }

  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </label>
      {values.length === 0 ? (
        <p className="mb-2 text-xs text-subtle">{emptyHint}</p>
      ) : (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
              style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="opacity-60 hover:opacity-100"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        onBlur={commit}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
        style={fieldStyle}
      />
    </div>
  )
}
