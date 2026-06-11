'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save, AlertCircle, Loader2, Check, LayoutTemplate } from 'lucide-react'
import {
  TEMPLATE_SECTION_KEYS,
  SECTION_META,
  TEMPLATE_CATEGORIES,
  CATEGORY_META,
  TEMPLATE_LIMITS,
  validateDraft,
  type TemplateCategory,
  type TemplateSectionKey,
  type TemplateDraft,
} from '@/lib/templates'
import { captureTemplate } from '@/app/dashboard/[guildId]/(management)/templates/actions'
import { Modal } from './Modal'
import { TemplateIcon, TEMPLATE_ICON_CHOICES } from './icons'

type Props = {
  guildId: string
  /** Sections that currently hold config in this server (others are disabled). */
  capturable: TemplateSectionKey[]
  onClose: () => void
  onCreated: () => void
}

export function TemplateCreatePanel({ guildId, capturable, onClose, onCreated }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const capturableSet = useMemo(() => new Set(capturable), [capturable])

  const [draft, setDraft] = useState<TemplateDraft>(() => ({
    name: '',
    description: '',
    category: 'custom',
    icon: 'LayoutTemplate',
    sectionKeys: [...capturable],
  }))

  const set = <K extends keyof TemplateDraft>(key: K, value: TemplateDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  function toggleSection(key: TemplateSectionKey) {
    setDraft((d) => ({
      ...d,
      sectionKeys: d.sectionKeys.includes(key)
        ? d.sectionKeys.filter((k) => k !== key)
        : [...d.sectionKeys, key],
    }))
  }

  async function onSave() {
    const validationError = validateDraft(draft)
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    const res = await captureTemplate(guildId, {
      name: draft.name,
      description: draft.description,
      category: draft.category,
      icon: draft.icon,
      sectionKeys: draft.sectionKeys,
    })
    setSaving(false)
    if (res.ok) {
      router.refresh()
      onCreated()
    } else {
      setError(res.error)
    }
  }

  const nothingCapturable = capturable.length === 0

  return (
    <Modal
      title="Save as template"
      subtitle="Snapshot this server's configuration to reuse it elsewhere."
      icon={<LayoutTemplate size={17} />}
      busy={saving}
      onClose={onClose}
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
            disabled={saving || nothingCapturable}
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

      {nothingCapturable && (
        <div
          className="mb-4 rounded-lg border px-3 py-2.5 text-sm"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-2)' }}
        >
          This server has no configured features to capture yet. Set up automations, moderation, tickets or roles first.
        </div>
      )}

      <div className="space-y-5">
        {/* Name + description */}
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
                <option key={c} value={c}>
                  {CATEGORY_META[c].label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Description" hint={`${draft.description.length}/${TEMPLATE_LIMITS.descriptionMax}`}>
          <textarea
            value={draft.description}
            onChange={(e) => set('description', e.target.value.slice(0, TEMPLATE_LIMITS.descriptionMax))}
            rows={2}
            placeholder="What is this setup for? (optional)"
            className="w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
        </Field>

        {/* Icon picker */}
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

        {/* Sections to capture */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Include in this template</p>
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              {draft.sectionKeys.length} selected
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {TEMPLATE_SECTION_KEYS.map((key) => {
              const meta = SECTION_META[key]
              const available = capturableSet.has(key)
              const checked = draft.sectionKeys.includes(key) && available
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!available}
                  onClick={() => toggleSection(key)}
                  className="flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors disabled:opacity-45"
                  style={{
                    background: checked ? 'var(--p-soft)' : 'var(--bg-2)',
                    borderColor: checked ? 'var(--p-1)' : 'var(--line-strong)',
                  }}
                >
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border"
                    style={{
                      background: checked ? 'var(--p-1)' : 'transparent',
                      borderColor: checked ? 'var(--p-1)' : 'var(--line-strong)',
                      color: '#fff',
                    }}
                  >
                    {checked && <Check size={13} />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <span style={{ color: meta.accent }}>
                        <TemplateIcon name={meta.icon} size={13} />
                      </span>
                      {meta.label}
                    </span>
                    <span className="mt-0.5 block text-xs" style={{ color: 'var(--text-3)' }}>
                      {available ? meta.description : 'Nothing configured to capture'}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
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
