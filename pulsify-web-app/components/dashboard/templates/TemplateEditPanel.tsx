'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save, AlertCircle, Loader2, Pencil } from 'lucide-react'
import {
  TEMPLATE_CATEGORIES,
  CATEGORY_META,
  TEMPLATE_LIMITS,
  type TemplateCategory,
  type ServerTemplate,
} from '@/lib/templates'
import { updateTemplateMeta } from '@/app/dashboard/[guildId]/templates/actions'
import { Modal } from './Modal'
import { TemplateIcon, TEMPLATE_ICON_CHOICES } from './icons'

type Props = {
  guildId: string
  template: ServerTemplate
  onClose: () => void
  onSaved: () => void
}

/** Edit a saved template's presentation (name / description / category / icon).
 *  The captured config sections are immutable — re-capture to refresh them. */
export function TemplateEditPanel({ guildId, template, onClose, onSaved }: Props) {
  const router = useRouter()
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  const [category, setCategory] = useState<TemplateCategory>(template.category)
  const [icon, setIcon] = useState(template.icon)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSave() {
    if (!name.trim()) {
      setError('Give the template a name.')
      return
    }
    setSaving(true)
    setError(null)
    const res = await updateTemplateMeta(guildId, template.id, { name, description, category, icon })
    setSaving(false)
    if (res.ok) {
      router.refresh()
      onSaved()
    } else {
      setError(res.error)
    }
  }

  return (
    <Modal
      title="Edit template details"
      subtitle="Update how this template is presented in your library."
      icon={<Pencil size={17} />}
      busy={saving}
      onClose={onClose}
      maxWidth="max-w-xl"
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
            Save
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
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, TEMPLATE_LIMITS.nameMax))}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, TEMPLATE_LIMITS.descriptionMax))}
            rows={2}
            className="w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as TemplateCategory)}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          >
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-foreground">Icon</span>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_ICON_CHOICES.map((n) => {
              const active = icon === n
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setIcon(n)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border transition-colors"
                  style={{
                    background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                    borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                    color: active ? 'var(--p-1)' : 'var(--text-3)',
                  }}
                >
                  <TemplateIcon name={n} size={16} />
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}
