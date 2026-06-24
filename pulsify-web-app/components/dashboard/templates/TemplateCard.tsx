'use client'

import { Download, Trash2, Pencil, Rocket, Star, Clock, Repeat2, Power } from 'lucide-react'
import {
  CATEGORY_META,
  FEATURE_META,
  featureKeysEnabled,
  featureKeysDecided,
  type ServerTemplate,
} from '@/lib/templates'
import { TemplateIcon } from './icons'

type Props = {
  template: ServerTemplate
  onApply: () => void
  onExport: () => void
  onEdit?: () => void
  onDelete?: () => void
}

function timeAgo(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const day = 86_400_000
  if (diff < day) return 'today'
  if (diff < 2 * day) return 'yesterday'
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function TemplateCard({ template, onApply, onExport, onEdit, onDelete }: Props) {
  const cat = CATEGORY_META[template.category]
  const enabledKeys = featureKeysEnabled(template.features)
  const decidedCount = featureKeysDecided(template.features).length
  const offCount = decidedCount - enabledKeys.length

  return (
    <div
      className="group flex flex-col rounded-xl border p-4 transition-colors"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="mb-3 flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `color-mix(in srgb, ${cat.accent} 16%, transparent)`, color: cat.accent }}
        >
          <TemplateIcon name={template.icon} size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-foreground">{template.name}</h3>
            {template.builtin && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
              >
                <Star size={9} /> Official
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] font-medium" style={{ color: cat.accent }}>
            {cat.label}
          </p>
        </div>
      </div>

      {template.description && (
        <p className="mb-3 line-clamp-2 text-sm" style={{ color: 'var(--text-2)' }}>
          {template.description}
        </p>
      )}

      {/* Feature chips — what this profile turns ON. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {enabledKeys.length === 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line)' }}>
            <Power size={10} /> Everything off
          </span>
        ) : (
          enabledKeys.map((k) => {
            const meta = FEATURE_META[k]
            return (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: 'var(--bg-2)', color: 'var(--text-2)', border: '1px solid var(--line)' }}
              >
                <span style={{ color: meta.accent }}>
                  <TemplateIcon name={meta.icon} size={10} />
                </span>
                {meta.label}
              </span>
            )
          })
        )}
      </div>

      <p className="mb-4 text-[11px]" style={{ color: 'var(--text-3)' }}>
        <span style={{ color: '#34d399' }}>{enabledKeys.length} on</span>
        {offCount > 0 && <> · {offCount} off</>}
      </p>

      {/* Meta row */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
        <span className="inline-flex items-center gap-1">
          <Clock size={11} /> {timeAgo(template.createdAt)}
        </span>
        {!template.builtin && template.authorName && <span>by {template.authorName}</span>}
        {!template.builtin && (
          <span className="inline-flex items-center gap-1">
            <Repeat2 size={11} /> {template.usageCount} use{template.usageCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-auto flex items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
        <button
          onClick={onApply}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
        >
          <Rocket size={14} /> Apply
        </button>
        <button
          onClick={onExport}
          title="Export as JSON"
          aria-label="Export template"
          className="rounded-lg border p-1.5 transition-colors hover:text-foreground"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
        >
          <Download size={15} />
        </button>
        {onEdit && (
          <button
            onClick={onEdit}
            title="Edit details"
            aria-label="Edit template"
            className="rounded-lg border p-1.5 transition-colors hover:text-foreground"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <Pencil size={15} />
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            title="Delete template"
            aria-label="Delete template"
            className="rounded-lg border p-1.5 transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: '#f87171' }}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
