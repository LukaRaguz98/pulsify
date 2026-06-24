'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Wand2, ArrowRight, ArrowLeft, Check, Loader2, AlertCircle,
  CheckCircle2, Library, AlertTriangle, Power, PowerOff,
} from 'lucide-react'
import { Modal } from '@/components/dashboard/templates/Modal'
import { TemplateIcon } from '@/components/dashboard/templates/icons'
import { FeatureToggleList } from '@/components/dashboard/templates/FeatureToggleList'
import {
  FEATURE_GROUP_META,
  FEATURE_META,
  featureKeysEnabled,
  type FeatureKey,
  type FeatureMap,
} from '@/lib/templates'
import {
  QUICK_SETUP_PRESETS, findQuickSetupPreset, buildQuickSetup,
} from '@/lib/quick-setup'
import {
  createQuickSetupTemplate, type ApplySummary,
} from '@/app/dashboard/[guildId]/(management)/templates/actions'

type Props = { guildId: string; guildName: string; onClose: () => void }

type Result = { name: string; summary: ApplySummary | null; applied: boolean }

const STEP_LABELS = ['Preset', 'Features', 'Review'] as const

export function QuickSetupWizard({ guildId, guildName, onClose }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [presetId, setPresetId] = useState(QUICK_SETUP_PRESETS[0].id)
  const [features, setFeatures] = useState<FeatureMap>(() => ({ ...QUICK_SETUP_PRESETS[0].features }))
  const [name, setName] = useState('')
  const [applyNow, setApplyNow] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  const preset = findQuickSetupPreset(presetId)!
  const enabledKeys = featureKeysEnabled(features)

  function choosePreset(id: string) {
    const p = findQuickSetupPreset(id)
    if (!p) return
    setPresetId(id)
    setFeatures({ ...p.features })
  }

  function setFeature(key: FeatureKey, on: boolean) {
    setFeatures((f) => ({ ...f, [key]: on }))
  }

  async function onFinish() {
    const built = buildQuickSetup({ presetId, features, name })
    if (!built) {
      setError('Turn on at least one feature for Pulsify to set up.')
      return
    }
    setSaving(true)
    setError(null)
    const res = await createQuickSetupTemplate(guildId, { ...built, apply: applyNow })
    setSaving(false)
    if (res.ok) {
      setResult({ name: res.data.template.name, summary: res.data.summary, applied: applyNow })
      router.refresh()
    } else {
      setError(res.error)
    }
  }

  // ── Success state ───────────────────────────────────────────────────────────
  if (result) {
    const changed = (result.summary?.applied ?? []).filter(Boolean)
    return (
      <Modal
        title="Quick setup complete"
        subtitle="Your feature profile is saved and ready to reuse."
        icon={<CheckCircle2 size={17} />}
        onClose={onClose}
        maxWidth="max-w-xl"
        footer={
          <>
            <button onClick={onClose} className="rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
              Done
            </button>
            <Link href={`/dashboard/${guildId}/templates`} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
              <Library size={15} /> Open in library
            </Link>
          </>
        }
      >
        <div className="flex flex-col items-center text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
            <CheckCircle2 size={28} />
          </span>
          <p className="font-semibold text-foreground">“{result.name}” is in your library</p>
          <p className="mt-1.5 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
            {result.applied
              ? `Applied to ${guildName}. Fine-tune any feature from its settings, or re-apply this profile any time.`
              : 'Open it in the library to tweak it and apply it whenever you’re ready.'}
          </p>
        </div>

        {result.applied && changed.length > 0 && (
          <div className="mt-5 space-y-1.5">
            {changed.map((a) => (
              <div key={a.key} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
                <span className="flex items-center gap-2 font-medium text-foreground">
                  {a.enabled ? <Power size={14} style={{ color: '#22c55e' }} /> : <PowerOff size={14} style={{ color: 'var(--text-3)' }} />} {a.label}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>{a.detail}</span>
              </div>
            ))}
          </div>
        )}

        {result.applied && result.summary && result.summary.warnings.length > 0 && (
          <div className="mt-4 space-y-1.5 rounded-lg border px-3 py-2.5 text-xs" style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}>
            {result.summary.warnings.map((w, i) => (
              <p key={i} className="flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}</p>
            ))}
          </div>
        )}
      </Modal>
    )
  }

  // ── Wizard ──────────────────────────────────────────────────────────────────
  const canNext = step === 1 ? enabledKeys.length > 0 : true

  return (
    <Modal
      title="Quick setup"
      subtitle={`Configure ${guildName} from a preset in a few clicks`}
      icon={<Wand2 size={17} />}
      busy={saving}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <StepDots step={step} />
          <div className="flex items-center gap-2.5">
            {step > 0 && (
              <button onClick={() => setStep((s) => s - 1)} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
                <ArrowLeft size={15} /> Back
              </button>
            )}
            {step < 2 ? (
              <button onClick={() => setStep((s) => s + 1)} disabled={!canNext} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
                Next <ArrowRight size={15} />
              </button>
            ) : (
              <button onClick={onFinish} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                {applyNow ? 'Create & apply' : 'Create profile'}
              </button>
            )}
          </div>
        </div>
      }
    >
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Step 0 — preset */}
      {step === 0 && (
        <div>
          <StepHeading title="Start from a preset" hint="Each preset switches on a tuned set of Pulsify features — you can adjust them next." />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {QUICK_SETUP_PRESETS.map((p) => {
              const active = p.id === presetId
              const count = featureKeysEnabled(p.features).length
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choosePreset(p.id)}
                  className="flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors"
                  style={{ background: active ? 'var(--p-soft)' : 'var(--bg-2)', borderColor: active ? 'var(--p-1)' : 'var(--line-strong)' }}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                    <TemplateIcon name={p.icon} size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{p.name}</span>
                    <span className="mt-0.5 block text-xs" style={{ color: 'var(--text-3)' }}>{p.description}</span>
                    <span className="mt-1.5 block text-[11px] font-medium" style={{ color: 'var(--p-1)' }}>{count} feature{count === 1 ? '' : 's'} on</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Step 1 — features */}
      {step === 1 && (
        <div>
          <StepHeading title="What should be switched on?" hint={`Tuned for the ${preset.name} preset. Toggle anything you want.`} />
          <FeatureToggleList features={features} onChange={setFeature} groupMeta={FEATURE_GROUP_META} />
        </div>
      )}

      {/* Step 2 — review */}
      {step === 2 && (
        <div className="space-y-5">
          <StepHeading title="Name it and finish" hint="Saved to your library so you can reuse and edit it." />

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Profile name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              placeholder={`${preset.name} setup`}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          </label>

          <div>
            <span className="mb-2 block text-sm font-medium text-foreground">Turns on ({enabledKeys.length})</span>
            {enabledKeys.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>Nothing selected — go back and switch on at least one feature.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {enabledKeys.map((key) => (
                  <span key={key} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
                    <span style={{ color: FEATURE_META[key].accent }}>
                      <TemplateIcon name={FEATURE_META[key].icon} size={12} />
                    </span>
                    {FEATURE_META[key].label}
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setApplyNow((v) => !v)}
            className="flex w-full items-start gap-2.5 rounded-xl border p-3.5 text-left transition-colors"
            style={{ background: applyNow ? 'var(--p-soft)' : 'var(--bg-2)', borderColor: applyNow ? 'var(--p-1)' : 'var(--line-strong)' }}
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border" style={{ background: applyNow ? 'var(--p-1)' : 'transparent', borderColor: applyNow ? 'var(--p-1)' : 'var(--line-strong)', color: '#fff' }}>
              {applyNow && <Check size={13} />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">Apply to {guildName} now</span>
              <span className="mt-0.5 block text-xs" style={{ color: 'var(--text-3)' }}>
                Switches these features on/off right away. You configure each feature&apos;s specifics in its own settings.
              </span>
            </span>
          </button>
        </div>
      )}
    </Modal>
  )
}

function StepHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>{hint}</p>
    </div>
  )
}

function StepDots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {STEP_LABELS.map((label, i) => {
        const active = i === step
        const done = i < step
        return (
          <span key={label} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: active ? 'var(--text)' : 'var(--text-3)' }}>
            <span className="flex h-5 w-5 items-center justify-center rounded-full text-[11px]" style={{ background: active || done ? 'var(--p-1)' : 'var(--bg-2)', color: active || done ? '#fff' : 'var(--text-3)' }}>
              {done ? <Check size={12} /> : i + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </span>
        )
      })}
    </div>
  )
}
