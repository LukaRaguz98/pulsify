'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save, AlertCircle, Loader2, LayoutTemplate } from 'lucide-react'
import {
  FEATURE_KEYS,
  FEATURE_GROUP_META,
  TEMPLATE_CATEGORIES,
  CATEGORY_META,
  TEMPLATE_LIMITS,
  validateDraft,
  type TemplateCategory,
  type TemplateDraft,
  type FeatureMap,
  type FeatureKey,
} from '@/lib/templates'
import { saveTemplate } from '@/app/dashboard/[guildId]/(management)/templates/actions'
import { Modal } from './Modal'
import { TemplateIcon, TEMPLATE_ICON_CHOICES } from './icons'
import { FeatureToggleList } from './FeatureToggleList'

type Props = {
  guildId: string
  /** This server's current feature on/off states — seeds the toggles. */
  currentFeatures: FeatureMap
  onClose: () => void
  onCreated: () => void
}

export function TemplateCreatePanel({ guildId, currentFeatures, onClose, onCreated }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [draft, setDraft] = useState<TemplateDraft>(() => ({
    name: '',
    description: '',
    category: 'custom',
    icon: 'LayoutTemplate',
    // Seed from the live server so "Save as template" snapshots current state,
    // then let the admin tweak any switch before saving.
    features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, Boolean(currentFeatures[k])])) as FeatureMap,
  }))

  const set = <K extends keyof TemplateDraft>(key: K, value: TemplateDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  function setFeature(key: FeatureKey, on: boolean) {
    setDraft((d) => ({ ...d, features: { ...d.features, [key]: on } }))
  }

  async function onSave() {
    const validationError = validateDraft(draft)
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    const res = await saveTemplate(guildId, {
      name: draft.name,
      description: draft.description,
      category: draft.category,
      icon: draft.icon,
      features: draft.features,
    })
    setSaving(false)
    if (res.ok) {
      router.refresh()
      onCreated()
    } else {
      setError(res.error)
    }
  }

  return (
    <Modal
      title="Save as template"
      subtitle="Snapshot which Pulsify features are on, to reuse on any server."
      icon={<LayoutTemplate size={17} />}
      busy={saving}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Save template
          </button>
        </>
      }
    >
      {error && (
        <div
          className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" hint={`${draft.name.length}/${TEMPLATE_LIMITS.nameMax}`}>
            <input
              value={draft.name}
              onChange={(e) => set('name', e.target.value.slice(0, TEMPLATE_LIMITS.nameMax))}
              placeholder="e.g. My gaming server setup"
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          </Field>
          <Field label="Category">
            <select
              value={draft.category}
              onChange={(e) => set('category', e.target.value as TemplateCategory)}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            >
              {TEMPLATE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_META[c].label}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Description" hint={`${draft.description.length}/${TEMPLATE_LIMITS.descriptionMax}`}>
          <textarea
            value={draft.description}
            onChange={(e) => set('description', e.target.value.slice(0, TEMPLATE_LIMITS.descriptionMax))}
            rows={2}
            placeholder="What is this profile for? (optional)"
            className="w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
        </Field>

        <Field label="Icon">
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_ICON_CHOICES.map((name) => {
              const active = draft.icon === name
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => set('icon', name)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border transition-colors"
                  style={{
                    background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                    borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                    color: active ? 'var(--p-1)' : 'var(--text-3)',
                  }}
                >
                  <TemplateIcon name={name} size={16} />
                </button>
              )
            })}
          </div>
        </Field>

        <div>
          <p className="mb-1 text-sm font-medium text-foreground">Features</p>
          <p className="mb-3 text-xs" style={{ color: 'var(--text-3)' }}>
            Toggle what this profile turns on or off. Seeded from this server&apos;s current setup.
          </p>
          <FeatureToggleList features={draft.features} onChange={setFeature} groupMeta={FEATURE_GROUP_META} />
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{hint}</span>}
      </div>
      {children}
    </label>
  )
}
