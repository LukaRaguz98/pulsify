'use client'

import { Lock } from 'lucide-react'
import {
  FEATURE_KEYS,
  FEATURE_META,
  type FeatureKey,
  type FeatureMap,
  type FeatureMeta,
} from '@/lib/templates'
import { PLAN_LABELS } from '@/lib/billing'
import { usePlan } from '@/components/billing/PlanProvider'
import { TemplateIcon } from './icons'

type GroupKey = FeatureMeta['group']

type Props = {
  features: FeatureMap
  onChange: (key: FeatureKey, on: boolean) => void
  groupMeta: Record<GroupKey, { label: string; icon: string }>
}

const GROUP_ORDER: GroupKey[] = ['experience', 'engagement', 'safety']

/** Grouped on/off list of every Pulsify feature a template can switch. Shared by
 *  the create panel and the quick-setup wizard so the toggle UX is identical. */
export function FeatureToggleList({ features, onChange, groupMeta }: Props) {
  const { atLeast } = usePlan()
  return (
    <div className="space-y-4">
      {GROUP_ORDER.map((group) => {
        const keys = FEATURE_KEYS.filter((k) => FEATURE_META[k].group === group)
        if (keys.length === 0) return null
        const meta = groupMeta[group]
        return (
          <div key={group}>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              <TemplateIcon name={meta.icon} size={12} />
              {meta.label}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {keys.map((key) => {
                const fm = FEATURE_META[key]
                const on = features[key] === true
                // Locked when the feature needs a higher plan than the user has.
                // `atLeast` already returns true during early access, so nothing
                // is locked until early access ends.
                const locked = fm.plan !== 'free' && !atLeast(fm.plan)
                return (
                  <div
                    key={key}
                    className="flex items-center gap-3 rounded-lg border p-3"
                    style={{
                      background: on && !locked ? 'var(--p-soft)' : 'var(--bg-2)',
                      borderColor: on && !locked ? 'var(--p-1)' : 'var(--line-strong)',
                      opacity: locked ? 0.7 : 1,
                    }}
                    title={locked ? `Requires the ${PLAN_LABELS[fm.plan]} plan` : undefined}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${fm.accent}1f`, color: fm.accent }}>
                      <TemplateIcon name={fm.icon} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        {fm.label}
                        {fm.plan !== 'free' && (
                          <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                            {locked && <Lock size={8} />}
                            {PLAN_LABELS[fm.plan]}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs" style={{ color: 'var(--text-3)' }}>
                        {locked ? `Upgrade to ${PLAN_LABELS[fm.plan]} to enable this.` : fm.description}
                      </p>
                    </div>
                    <Switch on={on && !locked} disabled={locked} onChange={(v) => onChange(key, v)} />
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Switch({ on, onChange, disabled = false }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      style={{ background: on ? 'var(--p-1)' : 'var(--line-strong)' }}
    >
      <span className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" style={{ transform: on ? 'translateX(24px)' : 'translateX(4px)' }} />
    </button>
  )
}
