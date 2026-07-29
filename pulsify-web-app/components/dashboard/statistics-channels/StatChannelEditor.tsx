'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, AlertTriangle, Volume2, Wand2, Eye, Lock } from 'lucide-react'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import {
  STAT_TYPES,
  STAT_GROUPS,
  STAT_LIMITS,
  statMeta,
  renderStatName,
  formatStatValue,
  validateStatChannelDraft,
  type StatChannel,
  type StatChannelDraft,
  type StatType,
  type UpdateMode,
  type Visibility,
} from '@/lib/statistics-channels'
import type { StatValues } from '@/lib/statistics-values'

type CategoryOption = { id: string; name: string }

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

export function StatChannelEditor({
  guildId,
  channel,
  categories,
  values,
  existingStatTypes,
  onClose,
  onSaved,
}: {
  guildId: string
  channel: StatChannel | null
  categories: CategoryOption[]
  values: StatValues
  /** stat types already used by other channels — powers the duplicate warning. */
  existingStatTypes: StatType[]
  onClose: () => void
  onSaved: (row: StatChannel, isNew: boolean) => void
}) {
  const editing = !!channel
  const initialStat = channel?.stat_type ?? 'total_members'

  const [statType, setStatType] = useState<StatType>(initialStat)
  const [template, setTemplate] = useState(
    channel?.name_template ?? statMeta(initialStat)?.defaultTemplate ?? '{value}',
  )
  const [categoryId, setCategoryId] = useState<string>(channel?.category_id ?? '')
  const [updateMode, setUpdateMode] = useState<UpdateMode>(channel?.update_mode ?? 'auto')
  const [visibility, setVisibility] = useState<Visibility>(channel?.visibility ?? 'everyone')
  const [enabled, setEnabled] = useState(channel?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // When the API reports a duplicate, we surface a confirm + resend with allow.
  const [dupPrompt, setDupPrompt] = useState(false)

  useDialogDismiss(onClose, busy)

  const meta = statMeta(statType)

  // Pick a statistic → adopt its default template (only while creating, and only
  // if the admin hasn't hand-edited away from the previous default).
  function pickStat(next: StatType) {
    const prevDefault = statMeta(statType)?.defaultTemplate
    setStatType(next)
    if (!editing && template.trim() === (prevDefault ?? '').trim()) {
      setTemplate(statMeta(next)?.defaultTemplate ?? '{value}')
    }
  }

  const previewName = useMemo(() => {
    const raw = values[statType]
    const formatted = raw === undefined ? '…' : formatStatValue(statType, raw)
    return renderStatName(template, statType, formatted)
  }, [template, statType, values])

  const duplicateWarning =
    !editing && existingStatTypes.includes(statType)
      ? `A "${meta?.label ?? statType}" channel already exists — you can still create another.`
      : null

  async function save(allowDuplicate = false) {
    const draft: StatChannelDraft = {
      stat_type: statType,
      // Statistic channels are always locked voice channels — the category-header
      // variant was dropped (it couldn't be made reliably visible on Discord).
      channel_type: 'voice',
      category_id: categoryId || null,
      name_template: template.trim(),
      update_mode: updateMode,
      visibility,
      enabled,
    }
    const validationError = validateStatChannelDraft(draft)
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy(true)
    setError(null)

    const url = editing
      ? `/api/discord/guild/${guildId}/statistics-channels/${channel!.id}`
      : `/api/discord/guild/${guildId}/statistics-channels`
    const res = await fetch(url, {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draft, allowDuplicate }),
    })
    setBusy(false)

    if (res.status === 409) {
      setDupPrompt(true)
      return
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Could not save the statistic channel.')
      return
    }
    const saved = (await res.json()) as StatChannel
    onSaved(saved, !editing)
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Edit statistic channel' : 'New statistic channel'}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <h2 className="font-semibold text-foreground">{editing ? 'Edit statistic channel' : 'New statistic channel'}</h2>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            {/* ── Form ─────────────────────────────────────────────── */}
            <div className="space-y-5">
              {/* Statistic */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Statistic</label>
                <select value={statType} onChange={(e) => pickStat(e.target.value as StatType)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle}>
                  {STAT_GROUPS.map((g) => (
                    <optgroup key={g.id} label={g.label}>
                      {STAT_TYPES.filter((s) => s.group === g.id).map((s) => (
                        <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {meta && <p className="mt-1.5 text-xs" style={{ color: 'var(--text-3)' }}>{meta.description}</p>}
                {duplicateWarning && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs" style={{ color: '#f59e0b' }}>
                    <AlertTriangle size={12} /> {duplicateWarning}
                  </p>
                )}
              </div>

              {/* Visibility */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Who can see it</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    { id: 'everyone' as const, label: 'Everyone', icon: <Eye size={13} />, hint: 'Visible, no join' },
                    { id: 'admins' as const, label: 'Admins only', icon: <Lock size={13} />, hint: 'Private padlock' },
                  ]).map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVisibility(v.id)}
                      className="flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-xs font-medium transition"
                      style={visibility === v.id ? { background: 'var(--p-soft)', color: 'var(--p-1)', borderColor: 'var(--p-1)' } : { ...fieldStyle, color: 'var(--text-2)' }}
                    >
                      <span className="flex items-center gap-1.5">{v.icon} {v.label}</span>
                      <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{v.hint}</span>
                    </button>
                  ))}
                </div>
                {visibility === 'admins' && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
                    <Lock size={11} /> Only staff/admins will see this channel (clean padlock). Members won&apos;t see the value.
                  </p>
                )}
              </div>

              {/* Name template */}
              <div>
                <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span>Name template</span>
                  <button
                    type="button"
                    onClick={() => setTemplate(meta?.defaultTemplate ?? '{value}')}
                    className="inline-flex items-center gap-1 text-[11px] transition hover:text-foreground"
                    style={{ color: 'var(--text-3)' }}
                  >
                    <Wand2 size={11} /> Use default
                  </button>
                </label>
                <input
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  maxLength={STAT_LIMITS.maxTemplate}
                  placeholder={meta?.defaultTemplate}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                  style={fieldStyle}
                />
                <p className="mt-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
                  Use <code className="rounded px-1" style={{ background: 'var(--bg-2)' }}>{'{value}'}</code>
                  {meta && <> or <code className="rounded px-1" style={{ background: 'var(--bg-2)' }}>{`{${meta.token}}`}</code></>} where the number goes. Emojis and text are supported.
                </p>
              </div>

              {/* Parent category */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Category (optional)</label>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle}>
                  <option value="">No category (top of the list)</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Update mode + enabled */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Updates</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      { id: 'auto' as const, label: 'Automatic' },
                      { id: 'manual' as const, label: 'Manual' },
                    ]).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setUpdateMode(m.id)}
                        className="rounded-lg border px-2 py-1.5 text-xs font-medium transition"
                        style={updateMode === m.id ? { background: 'var(--p-soft)', color: 'var(--p-1)', borderColor: 'var(--p-1)' } : { ...fieldStyle, color: 'var(--text-2)' }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Status</label>
                  <button
                    type="button"
                    onClick={() => setEnabled((v) => !v)}
                    className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition"
                    style={fieldStyle}
                  >
                    <span style={{ color: enabled ? '#22c55e' : 'var(--text-3)' }}>{enabled ? 'Enabled' : 'Disabled'}</span>
                    <span
                      className="relative inline-flex h-5 w-9 items-center rounded-full transition"
                      style={{ background: enabled ? 'var(--p-1)' : 'var(--line-strong)' }}
                    >
                      <span className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform" style={{ transform: enabled ? 'translateX(18px)' : 'translateX(3px)' }} />
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* ── Preview ─────────────────────────────────────────── */}
            <div className="lg:sticky lg:top-0 lg:self-start">
              {/* No "Preview" heading — the "Channel sidebar" mock below says it. */}
              <div className="rounded-xl border p-3" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Channel sidebar</p>
                <div className="flex items-center gap-2 rounded px-2 py-1.5" style={{ background: 'color-mix(in srgb, var(--text) 6%, transparent)' }}>
                  {visibility === 'admins' ? <Lock size={15} style={{ color: 'var(--text-3)' }} /> : <Volume2 size={15} style={{ color: 'var(--text-3)' }} />}
                  <span className="truncate text-sm" style={{ color: 'var(--text-2)' }}>{previewName}</span>
                </div>
                <p className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
                  Current value: <strong style={{ color: 'var(--text-2)' }}>{values[statType] === undefined ? '…' : formatStatValue(statType, values[statType])}</strong>
                </p>
              </div>
              <p className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
                Pulse refreshes the name only when the value changes, at most every 10 minutes (Discord rate limit).
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          {dupPrompt ? (
            <>
              <span className="mr-auto text-xs" style={{ color: '#f59e0b' }}>A channel for this statistic already exists.</span>
              <button type="button" onClick={() => setDupPrompt(false)} disabled={busy} className="rounded-lg border px-4 py-2 text-xs font-medium transition disabled:opacity-50" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>Cancel</button>
              <button type="button" onClick={() => save(true)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-50" style={{ background: 'var(--p-1)' }}>
                {busy ? <Loader2 size={12} className="animate-spin" /> : null} Create anyway
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-4 py-2 text-xs font-medium transition disabled:opacity-50" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>Cancel</button>
              <button type="button" onClick={() => save()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-50" style={{ background: 'var(--p-1)' }}>
                {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                {editing ? 'Save changes' : 'Create channel'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
