'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, AlertCircle, Gift, Sparkles, Coins, Lock, Eye } from 'lucide-react'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import {
  CATEGORY_META,
  REWARD_CATEGORIES,
  COSMETIC_EFFECT,
  rolePayload,
  boosterPayload,
  giveawayEntryPayload,
  type ShopReward,
  type RewardCategory,
  type RewardScope,
} from '@/lib/shop'
import { CategoryIcon } from './category-icons'
import { CosmeticPreview } from './CosmeticPreview'

export type RoleOption = { id: string; name: string; color?: number }
export type AchievementOption = { id: string; name: string }

type Props = {
  guildId: string
  roles: RoleOption[]
  achievements: AchievementOption[]
  editing: ShopReward | null
  onClose: (changed: boolean) => void
  /** 'server' (admin) by default; 'global' for the operator catalogue. */
  scope?: RewardScope
}

// Which categories each scope may use. Global is the operator-managed catalogue
// (cosmetics only); server admins get the full server-scoped set.
const SERVER_CATEGORIES = REWARD_CATEGORIES.filter((c) => CATEGORY_META[c].scopes.includes('server'))
const GLOBAL_CATEGORIES = REWARD_CATEGORIES.filter((c) => CATEGORY_META[c].scopes.includes('global'))

const FIELD_CLASS =
  'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-1'
const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

type Draft = {
  category: RewardCategory
  name: string
  description: string
  cost: string
  stock: string
  per_user_limit: string
  featured: boolean
  active: boolean
  // payload
  role_id: string
  duration_days: string
  multiplier: string
  duration_hours: string
  entries: string
  cosmetic_key: string
  effect: string
  color: string
  instructions: string
  // requirements
  min_reputation: string
  min_level: string
  achievement_ids: string[]
}

function toDraft(r: ShopReward | null, scope: RewardScope): Draft {
  const role = r ? rolePayload(r) : { roleId: '', durationDays: null }
  const boost = r && r.category === 'xp_booster' ? boosterPayload(r) : { multiplier: 2, durationHours: 24 }
  const ent = r && r.category === 'giveaway_entry' ? giveawayEntryPayload(r) : { entries: 1 }
  return {
    category: r?.category ?? (scope === 'global' ? 'cosmetic' : 'role'),
    name: r?.name ?? '',
    description: r?.description ?? '',
    cost: r ? String(r.cost) : '100',
    stock: r?.stock != null ? String(r.stock) : '',
    per_user_limit: r?.per_user_limit != null ? String(r.per_user_limit) : '',
    featured: r?.featured ?? false,
    active: r?.active ?? true,
    role_id: role.roleId ?? '',
    duration_days: role.durationDays != null ? String(role.durationDays) : '',
    multiplier: String(boost.multiplier),
    duration_hours: String(boost.durationHours),
    entries: String(ent.entries),
    cosmetic_key: r ? String(r.payload.cosmetic_key ?? r.payload.badge_key ?? '') : '',
    effect: r && typeof r.payload.effect === 'string' ? String(r.payload.effect) : COSMETIC_EFFECT.BADGE,
    color: r?.color ?? '#8b5cf6',
    instructions: r ? String(r.payload.instructions ?? '') : '',
    min_reputation: r?.requirements.min_reputation != null ? String(r.requirements.min_reputation) : '',
    min_level: r?.requirements.min_level != null ? String(r.requirements.min_level) : '',
    achievement_ids: r?.requirements.achievement_ids ?? [],
  }
}

export function RewardEditPanel({ guildId, roles, achievements, editing, onClose, scope = 'server' }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(editing, scope))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  useDialogDismiss(() => onClose(false), busy)

  const set = <K extends keyof Draft>(key: K, val: Draft[K]) => setDraft((d) => ({ ...d, [key]: val }))
  const meta = CATEGORY_META[draft.category]
  const categories = scope === 'global' ? GLOBAL_CATEGORIES : SERVER_CATEGORIES

  function buildPayload(): Record<string, unknown> {
    switch (draft.category) {
      case 'role':
        return { role_id: draft.role_id, duration_days: draft.duration_days ? Number(draft.duration_days) : null }
      case 'xp_booster':
        return { multiplier: Number(draft.multiplier), duration_hours: Number(draft.duration_hours) }
      case 'giveaway_entry':
        return { entries: Number(draft.entries) }
      case 'cosmetic':
        return { cosmetic_key: draft.cosmetic_key, effect: draft.effect || 'badge' }
      case 'perk':
        return { instructions: draft.instructions }
      default:
        return {}
    }
  }

  function buildRequirements(): Record<string, unknown> {
    const req: Record<string, unknown> = {}
    if (draft.min_reputation) req.min_reputation = Number(draft.min_reputation)
    if (draft.min_level) req.min_level = Number(draft.min_level)
    if (draft.achievement_ids.length) req.achievement_ids = draft.achievement_ids
    return req
  }

  async function save() {
    if (!draft.name.trim()) {
      setError('A reward name is required.')
      return
    }
    if (draft.category === 'role' && !draft.role_id) {
      setError('Pick a Discord role for this reward.')
      return
    }
    setBusy(true)
    setError(null)
    const payload = {
      scope,
      category: draft.category,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      cost: Number(draft.cost) || 0,
      stock: draft.stock ? Number(draft.stock) : null,
      per_user_limit: draft.per_user_limit ? Number(draft.per_user_limit) : null,
      featured: draft.featured,
      active: draft.active,
      // Cosmetics carry a colour (badge tint); other types don't use one.
      color: draft.category === 'cosmetic' ? draft.color || null : null,
      payload: buildPayload(),
      requirements: buildRequirements(),
    }
    try {
      const res = await fetch(
        editing
          ? `/api/guilds/${guildId}/economy/shop/${editing.id}`
          : `/api/guilds/${guildId}/economy/shop`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not save the reward.')
      onClose(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the reward.')
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onClose(false)}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Edit reward' : 'New reward'}
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
              <CategoryIcon category={draft.category} size={17} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-foreground">{editing ? 'Edit reward' : 'New reward'}</h2>
              <p className="truncate text-xs text-subtle">
                {editing ? 'Update what members get and what it costs.' : 'Define a reward members can buy with Pulse Coins.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose(false)}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Reward type + details */}
          <Section icon={<Gift size={13} />} label="Reward" description="The kind of reward and how members see it.">
            <Field label="Category">
              <select className={FIELD_CLASS} style={fieldStyle} value={draft.category} onChange={(e) => set('category', e.target.value as RewardCategory)}>
                {categories.map((c) => (
                  <option key={c} value={c}>{CATEGORY_META[c].label}</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-subtle">{meta.howItWorks}</p>
            </Field>

            <Field label="Name">
              <input className={FIELD_CLASS} style={fieldStyle} value={draft.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder="e.g. VIP role" />
            </Field>

            <Field label="Description" hint="optional">
              <textarea className={`${FIELD_CLASS} resize-none`} style={fieldStyle} rows={2} value={draft.description} maxLength={300} onChange={(e) => set('description', e.target.value)} placeholder="What the member gets…" />
            </Field>
          </Section>

          {/* What it grants — category-specific payload */}
          <Section icon={<Sparkles size={13} />} label="What it grants" description="Settings specific to this reward type.">
            {draft.category === 'role' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Discord role">
                  <select className={FIELD_CLASS} style={fieldStyle} value={draft.role_id} onChange={(e) => set('role_id', e.target.value)}>
                    <option value="">Select a role…</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
                <Field label="Duration (days)" hint="blank = permanent">
                  <input className={FIELD_CLASS} style={fieldStyle} type="number" min={1} value={draft.duration_days} onChange={(e) => set('duration_days', e.target.value)} placeholder="Permanent" />
                </Field>
              </div>
            )}
            {draft.category === 'xp_booster' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Multiplier (×)">
                  <input className={FIELD_CLASS} style={fieldStyle} type="number" min={1} max={5} value={draft.multiplier} onChange={(e) => set('multiplier', e.target.value)} />
                </Field>
                <Field label="Duration (hours)">
                  <input className={FIELD_CLASS} style={fieldStyle} type="number" min={1} value={draft.duration_hours} onChange={(e) => set('duration_hours', e.target.value)} />
                </Field>
              </div>
            )}
            {draft.category === 'giveaway_entry' && (
              <Field label="Bonus entries" hint="extra weight on the member's next giveaway entry">
                <input className={FIELD_CLASS} style={fieldStyle} type="number" min={1} value={draft.entries} onChange={(e) => set('entries', e.target.value)} />
              </Field>
            )}
            {draft.category === 'cosmetic' && (
              <>
                {scope === 'global' && (
                  <Field label="Effect" hint="what owning it does">
                    <select className={FIELD_CLASS} style={fieldStyle} value={draft.effect} onChange={(e) => set('effect', e.target.value)}>
                      <option value="badge">Profile badge — renders on the Pulse profile</option>
                      <option value="corner_hud">Corner HUD — unlocks the dashboard decoration toggle</option>
                    </select>
                  </Field>
                )}
                <Field label="Cosmetic key" hint="optional — identifies the cosmetic">
                  <input className={FIELD_CLASS} style={fieldStyle} value={draft.cosmetic_key} onChange={(e) => set('cosmetic_key', e.target.value)} placeholder="e.g. early-supporter" />
                </Field>
                {draft.effect !== 'corner_hud' && (
                  <Field label="Colour" hint="badge tint on the profile">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : '#8b5cf6'}
                        onChange={(e) => set('color', e.target.value)}
                        className="h-9 w-12 shrink-0 cursor-pointer rounded border"
                        style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
                        aria-label="Badge colour"
                      />
                      <input className={FIELD_CLASS} style={fieldStyle} value={draft.color} maxLength={7} onChange={(e) => set('color', e.target.value)} placeholder="#8b5cf6" />
                    </div>
                  </Field>
                )}
                {/* Live preview of how the cosmetic looks once owned. */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowPreview((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                  >
                    <Eye size={13} /> {showPreview ? 'Hide preview' : 'Preview'}
                  </button>
                  {showPreview && (
                    <div className="mt-3">
                      <CosmeticPreview
                        effect={draft.effect}
                        name={draft.name}
                        color={/^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : '#8b5cf6'}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
            {draft.category === 'perk' && (
              <Field label="Redemption instructions" hint="shown to staff when redeemed">
                <textarea className={`${FIELD_CLASS} resize-none`} style={fieldStyle} rows={2} value={draft.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder="What staff should do when this is redeemed…" />
              </Field>
            )}
          </Section>

          {/* Pricing & availability */}
          <Section icon={<Coins size={13} />} label="Pricing & availability" description="What it costs and how many members can own it.">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Cost (coins)"><input className={FIELD_CLASS} style={fieldStyle} type="number" min={0} value={draft.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
              <Field label="Stock" hint="∞"><input className={FIELD_CLASS} style={fieldStyle} type="number" min={0} value={draft.stock} onChange={(e) => set('stock', e.target.value)} placeholder="∞" /></Field>
              <Field label="Per user" hint="∞"><input className={FIELD_CLASS} style={fieldStyle} type="number" min={1} value={draft.per_user_limit} onChange={(e) => set('per_user_limit', e.target.value)} placeholder="∞" /></Field>
            </div>
            <Toggle label="Featured" description="Pin this reward to the top of the shop." checked={draft.featured} onChange={(v) => set('featured', v)} />
            <Toggle label="Active" description="Visible and buyable in the shop. Turn off to hide it without deleting." checked={draft.active} onChange={(v) => set('active', v)} />
          </Section>

          {/* Requirements */}
          <Section icon={<Lock size={13} />} label="Purchase requirements" description="Gates a member must meet to buy this (optional).">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min reputation" hint="0–100"><input className={FIELD_CLASS} style={fieldStyle} type="number" min={0} max={100} value={draft.min_reputation} onChange={(e) => set('min_reputation', e.target.value)} placeholder="0" /></Field>
              <Field label="Min level" hint="this server"><input className={FIELD_CLASS} style={fieldStyle} type="number" min={0} value={draft.min_level} onChange={(e) => set('min_level', e.target.value)} placeholder="0" /></Field>
            </div>
            {achievements.length > 0 && (
              <Field label="Required achievements">
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-lg border p-2" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
                  {achievements.map((a) => {
                    const on = draft.achievement_ids.includes(a.id)
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => set('achievement_ids', on ? draft.achievement_ids.filter((x) => x !== a.id) : [...draft.achievement_ids, a.id])}
                        className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors"
                        style={on
                          ? { borderColor: 'var(--p-1)', background: 'var(--p-soft)', color: 'var(--p-1)' }
                          : { borderColor: 'var(--line-strong)', background: 'transparent', color: 'var(--text-3)' }}
                      >
                        {a.name}
                      </button>
                    )
                  })}
                </div>
              </Field>
            )}
          </Section>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 border-t px-5 py-3.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          {error ? (
            <span className="flex min-w-0 items-center gap-1.5 text-sm" style={{ color: '#f87171' }}>
              <AlertCircle size={14} className="shrink-0" />
              <span className="truncate">{error}</span>
            </span>
          ) : (
            <span />
          )}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => !busy && onClose(false)}
              disabled={busy}
              className="rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all disabled:opacity-60"
              style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Gift size={15} />}
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create reward'}
            </button>
          </div>
        </footer>
      </aside>
    </div>,
    document.body,
  )
}

// ── Small form primitives (match MilestoneEditPanel for cross-view consistency) ─

function Section({
  icon,
  label,
  description,
  children,
}: {
  icon: React.ReactNode
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}>
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-2)' }}>{label}</h3>
          {description && <p className="text-xs text-subtle">{description}</p>}
        </div>
        <div className="ml-1 h-px flex-1" style={{ background: 'var(--line-strong)' }} />
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        {hint && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

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
    <div className="flex items-center justify-between gap-4 rounded-xl border p-3.5" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
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
      >
        <span
          className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  )
}
