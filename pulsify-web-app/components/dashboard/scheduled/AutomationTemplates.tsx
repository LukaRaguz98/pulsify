'use client'

import { ArrowRight, Clock } from 'lucide-react'
import {
  AUTOMATION_PRESETS,
  ACTION_BY_TYPE,
  describeSchedule,
  normaliseDraft,
  type AutomationPreset,
  type AutomationDraft,
} from '@/lib/automations'
import { ActionIcon } from './icons'

type Props = {
  onUseTemplate: (draft: AutomationDraft) => void
}

export function AutomationTemplates({ onUseTemplate }: Props) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-subtle">
        Start from a ready-made workflow. Pick one to open it in the builder, then choose the
        channel or role and tweak the schedule before saving.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AUTOMATION_PRESETS.map((preset) => (
          <TemplateCard key={preset.id} preset={preset} onUse={() => onUseTemplate(normaliseDraft(preset.draft))} />
        ))}
      </div>
    </div>
  )
}

function TemplateCard({ preset, onUse }: { preset: AutomationPreset; onUse: () => void }) {
  const def = ACTION_BY_TYPE[preset.draft.action_type]
  const color = def?.color ?? '#8b5cf6'
  return (
    <button
      type="button"
      onClick={onUse}
      className="group flex flex-col rounded-xl border p-4 text-left transition-colors"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}1f`, color }}>
          <ActionIcon name={preset.icon} size={16} />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{preset.name}</p>
          <p className="mt-0.5 text-xs leading-snug text-subtle">{preset.description}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3" style={{ borderColor: 'var(--line-strong)' }}>
        <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
          <Clock size={11} />
          {describeSchedule(preset.draft.schedule_type, preset.draft.schedule_config)}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--p-1)' }}>
          Use
          <ArrowRight size={11} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  )
}
