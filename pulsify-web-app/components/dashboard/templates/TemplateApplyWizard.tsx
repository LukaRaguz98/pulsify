'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Rocket,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Check,
  CheckCircle2,
  Power,
  PowerOff,
  Lock,
} from 'lucide-react'
import {
  FEATURE_META,
  featureKeysDecided,
  type ServerTemplate,
  type FeatureKey,
  type FeatureMap,
} from '@/lib/templates'
import { PLAN_LABELS } from '@/lib/billing'
import { usePlan } from '@/components/billing/PlanProvider'
import { applyTemplate, type ApplySummary } from '@/app/dashboard/[guildId]/(management)/templates/actions'
import { Modal } from './Modal'
import { TemplateIcon } from './icons'

type Props = {
  guildId: string
  guildName: string
  template: ServerTemplate
  currentFeatures: FeatureMap
  onClose: () => void
}

type Step = 'select' | 'result'

export function TemplateApplyWizard({ guildId, guildName, template, currentFeatures, onClose }: Props) {
  const router = useRouter()
  const { atLeast } = usePlan()
  const decided = useMemo(() => featureKeysDecided(template.features), [template])
  // A feature the template turns ON, but gated behind a plan the user lacks,
  // can't be applied. (Turning a feature OFF is always allowed.) `atLeast`
  // returns true during early access, so nothing is locked until it ends.
  const isLocked = (key: FeatureKey) =>
    template.features[key] === true && FEATURE_META[key].plan !== 'free' && !atLeast(FEATURE_META[key].plan)
  const [selected, setSelected] = useState<Set<FeatureKey>>(() => new Set(decided.filter((k) => !isLocked(k))))
  const [step, setStep] = useState<Step>('select')
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ApplySummary | null>(null)

  // A selected feature is a "change" when its desired state differs from current.
  const changeCount = useMemo(
    () => [...selected].filter((k) => template.features[k] !== Boolean(currentFeatures[k])).length,
    [selected, template.features, currentFeatures],
  )

  function toggle(key: FeatureKey) {
    if (isLocked(key)) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function onApply() {
    if (selected.size === 0) {
      setError('Select at least one feature to apply.')
      return
    }
    setApplying(true)
    setError(null)
    const res = await applyTemplate(guildId, {
      templateId: template.builtin ? undefined : template.id,
      builtinId: template.builtin ? template.id : undefined,
      featureKeys: [...selected],
    })
    setApplying(false)
    if (res.ok) {
      setSummary(res.data)
      setStep('result')
      router.refresh()
    } else {
      setError(res.error)
    }
  }

  return (
    <Modal
      title={step === 'result' ? 'Template applied' : `Apply "${template.name}"`}
      subtitle={
        step === 'result'
          ? `Feature switches are live on ${guildName}.`
          : 'Choose which features to switch, then review before applying.'
      }
      icon={step === 'result' ? <CheckCircle2 size={17} /> : <Rocket size={17} />}
      busy={applying}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        step === 'result' ? (
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
          >
            Done
          </button>
        ) : (
          <>
            <button
              onClick={onClose}
              disabled={applying}
              className="rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              Cancel
            </button>
            <button
              onClick={onApply}
              disabled={applying || selected.size === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
            >
              {applying ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}
              Apply {selected.size} feature{selected.size === 1 ? '' : 's'}
            </button>
          </>
        )
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

      {step === 'select' && (
        <div className="space-y-4">
          <div
            className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
            style={
              changeCount > 0
                ? { borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#fbbf24' }
                : { borderColor: 'var(--line)', background: 'var(--bg-2)', color: 'var(--text-3)' }
            }
          >
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              {changeCount > 0 ? (
                <>
                  This will change <strong>{changeCount}</strong> feature{changeCount === 1 ? '' : 's'} on {guildName}.
                  Applying a feature flips its master switch — you configure the specifics in each feature&apos;s settings.
                </>
              ) : (
                <>The selected features already match this server — applying changes nothing.</>
              )}
            </span>
          </div>

          <div className="space-y-2">
            {decided.map((key) => {
              const meta = FEATURE_META[key]
              const locked = isLocked(key)
              const checked = selected.has(key) && !locked
              const want = template.features[key] === true
              const current = Boolean(currentFeatures[key])
              const isChange = want !== current
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(key)}
                  disabled={locked}
                  title={locked ? `Requires the ${PLAN_LABELS[meta.plan]} plan` : undefined}
                  className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed"
                  style={{
                    background: checked ? 'var(--p-soft)' : 'var(--bg-2)',
                    borderColor: checked ? 'var(--p-1)' : 'var(--line-strong)',
                    opacity: locked ? 0.7 : 1,
                  }}
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border"
                    style={{
                      background: checked ? 'var(--p-1)' : 'transparent',
                      borderColor: checked ? 'var(--p-1)' : 'var(--line-strong)',
                      color: '#fff',
                    }}
                  >
                    {locked ? <Lock size={11} style={{ color: 'var(--text-3)' }} /> : checked && <Check size={13} />}
                  </span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${meta.accent}1f`, color: meta.accent }}>
                    <TemplateIcon name={meta.icon} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{meta.label}</span>
                    <span className="block text-xs" style={{ color: 'var(--text-3)' }}>
                      {locked ? `Upgrade to ${PLAN_LABELS[meta.plan]} to enable this.` : meta.description}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {locked ? (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                        <Lock size={10} /> {PLAN_LABELS[meta.plan]}
                      </span>
                    ) : (
                      <>
                        <StatePill on={want} />
                        {isChange && (
                          <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ background: 'rgba(245,158,11,0.16)', color: '#fbbf24' }}>
                            Change
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {step === 'result' && summary && (
        <div className="space-y-4">
          <div className="space-y-2">
            {summary.applied.map((a) => {
              const meta = FEATURE_META[a.key]
              return (
                <div
                  key={a.key}
                  className="flex items-center gap-3 rounded-lg border p-3"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={a.enabled ? { background: 'rgba(34,197,94,0.14)', color: '#4ade80' } : { background: 'var(--bg)', color: 'var(--text-3)' }}
                  >
                    {a.enabled ? <Power size={15} /> : <PowerOff size={15} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <span style={{ color: meta.accent }}>
                        <TemplateIcon name={meta.icon} size={12} />
                      </span>
                      {a.label}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>{a.detail}</p>
                  </div>
                </div>
              )
            })}
          </div>

          {summary.warnings.length > 0 && (
            <div
              className="space-y-1.5 rounded-lg border px-3 py-2.5 text-sm"
              style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#fbbf24' }}
            >
              {summary.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{w}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function StatePill({ on }: { on: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={on ? { background: 'rgba(34,197,94,0.14)', color: '#4ade80' } : { background: 'var(--bg)', color: 'var(--text-3)' }}
    >
      {on ? <Power size={10} /> : <PowerOff size={10} />}
      {on ? 'On' : 'Off'}
    </span>
  )
}
