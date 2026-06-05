'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Wand2, ArrowRight, ArrowLeft, Check, Loader2, AlertCircle, ShieldCheck,
  CheckCircle2, Library, AlertTriangle,
} from 'lucide-react'
import { Modal } from '@/components/dashboard/templates/Modal'
import { TemplateIcon } from '@/components/dashboard/templates/icons'
import { SECTION_META, type TemplateSectionKey } from '@/lib/templates'
import {
  QUICK_SETUP_ARCHETYPES, GUARD_SENSITIVITY_OPTIONS, findArchetype,
  archetypeSectionKeys, archetypeDefaultSensitivity, buildQuickSetup,
  type GuardSensitivity,
} from '@/lib/quick-setup'
import {
  createQuickSetupTemplate, type ApplySummary,
} from '@/app/dashboard/[guildId]/templates/actions'

type Props = { guildId: string; guildName: string; onClose: () => void }

type Result = { name: string; summary: ApplySummary | null; applied: boolean }

const STEP_LABELS = ['Type', 'Features', 'Review'] as const

export function QuickSetupWizard({ guildId, guildName, onClose }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [archetypeId, setArchetypeId] = useState(QUICK_SETUP_ARCHETYPES[0].id)
  const [sectionKeys, setSectionKeys] = useState<TemplateSectionKey[]>(() =>
    archetypeSectionKeys(QUICK_SETUP_ARCHETYPES[0].id),
  )
  const [sensitivity, setSensitivity] = useState<GuardSensitivity>(() =>
    archetypeDefaultSensitivity(QUICK_SETUP_ARCHETYPES[0].id),
  )
  const [name, setName] = useState('')
  const [applyNow, setApplyNow] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  const arch = findArchetype(archetypeId)!
  const available = useMemo(() => archetypeSectionKeys(archetypeId), [archetypeId])
  const guardSelected = sectionKeys.includes('pulse_guard')

  function chooseArchetype(id: string) {
    setArchetypeId(id)
    setSectionKeys(archetypeSectionKeys(id))
    setSensitivity(archetypeDefaultSensitivity(id))
  }

  function toggleSection(key: TemplateSectionKey) {
    setSectionKeys((keys) =>
      keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
    )
  }

  async function onFinish() {
    const built = buildQuickSetup({
      archetypeId, sectionKeys, guardSensitivity: sensitivity, name, description: '',
    })
    if (!built) {
      setError('Pick at least one thing for Pulsify to set up.')
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
    return (
      <Modal
        title="Quick setup complete"
        subtitle="Your configuration is saved and ready to reuse."
        icon={<CheckCircle2 size={17} />}
        onClose={onClose}
        maxWidth="max-w-xl"
        footer={
          <>
            <button
              onClick={onClose}
              className="rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              Done
            </button>
            <Link
              href={`/dashboard/${guildId}/templates`}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
            >
              <Library size={15} /> Open in library
            </Link>
          </>
        }
      >
        <div className="flex flex-col items-center text-center">
          <span
            className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            <CheckCircle2 size={28} />
          </span>
          <p className="font-semibold text-foreground">
            “{result.name}” is in your library
          </p>
          <p className="mt-1.5 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
            {result.applied
              ? `Applied to ${guildName}. You can fine-tune anything from the library at any time.`
              : 'Open it in the library to tweak the details and apply it whenever you’re ready.'}
          </p>
        </div>

        {result.applied && result.summary && result.summary.applied.length > 0 && (
          <div className="mt-5 space-y-1.5">
            {result.summary.applied.map((a) => (
              <div
                key={a.key}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
              >
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <Check size={14} style={{ color: '#22c55e' }} /> {a.label}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>{a.detail}</span>
              </div>
            ))}
          </div>
        )}

        {result.applied && result.summary && result.summary.warnings.length > 0 && (
          <div
            className="mt-4 space-y-1.5 rounded-lg border px-3 py-2.5 text-xs"
            style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}
          >
            {result.summary.warnings.map((w, i) => (
              <p key={i} className="flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
              </p>
            ))}
          </div>
        )}
      </Modal>
    )
  }

  // ── Wizard ──────────────────────────────────────────────────────────────────
  const canNext = step === 1 ? sectionKeys.length > 0 : true

  return (
    <Modal
      title="Quick setup"
      subtitle={`Configure ${guildName} from a few quick choices`}
      icon={<Wand2 size={17} />}
      busy={saving}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <StepDots step={step} />
          <div className="flex items-center gap-2.5">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              >
                <ArrowLeft size={15} /> Back
              </button>
            )}
            {step < 2 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canNext}
                className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
              >
                Next <ArrowRight size={15} />
              </button>
            ) : (
              <button
                onClick={onFinish}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                {applyNow ? 'Create & apply' : 'Create setup'}
              </button>
            )}
          </div>
        </div>
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

      {/* Step 0 — community type */}
      {step === 0 && (
        <div>
          <StepHeading
            title="What kind of community is this?"
            hint="We’ll start from a proven setup — you can change everything next."
          />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {QUICK_SETUP_ARCHETYPES.map((a) => {
              const active = a.id === archetypeId
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => chooseArchetype(a.id)}
                  className="flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors"
                  style={{
                    background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                    borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                  }}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: `${a.accent}1f`, color: a.accent }}
                  >
                    <TemplateIcon name={a.icon} size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{a.label}</span>
                    <span className="mt-0.5 block text-xs" style={{ color: 'var(--text-3)' }}>
                      {a.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Step 1 — features */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <StepHeading
              title="What should Pulsify set up?"
              hint={`Tailored for a ${arch.label.toLowerCase()}. Toggle anything you don’t need.`}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              {available.map((key) => {
                const meta = SECTION_META[key]
                const checked = sectionKeys.includes(key)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleSection(key)}
                    className="flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors"
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
                        {meta.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {guardSelected && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <ShieldCheck size={14} style={{ color: 'var(--p-1)' }} /> Moderation strictness
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {GUARD_SENSITIVITY_OPTIONS.map((o) => {
                  const active = sensitivity === o.id
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setSensitivity(o.id)}
                      className="rounded-lg border p-3 text-left transition-colors"
                      style={{
                        background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                        borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                      }}
                    >
                      <span className="block text-sm font-semibold text-foreground">{o.label}</span>
                      <span className="mt-0.5 block text-xs" style={{ color: 'var(--text-3)' }}>
                        {o.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2 — review */}
      {step === 2 && (
        <div className="space-y-5">
          <StepHeading title="Name it and finish" hint="Saved to your library so you can reuse and edit it." />

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Setup name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              placeholder={`${arch.label} setup`}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          </label>

          <div>
            <span className="mb-2 block text-sm font-medium text-foreground">Includes</span>
            <div className="flex flex-wrap gap-1.5">
              {sectionKeys.map((key) => (
                <span
                  key={key}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                >
                  <span style={{ color: SECTION_META[key].accent }}>
                    <TemplateIcon name={SECTION_META[key].icon} size={12} />
                  </span>
                  {SECTION_META[key].label}
                </span>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setApplyNow((v) => !v)}
            className="flex w-full items-start gap-2.5 rounded-xl border p-3.5 text-left transition-colors"
            style={{
              background: applyNow ? 'var(--p-soft)' : 'var(--bg-2)',
              borderColor: applyNow ? 'var(--p-1)' : 'var(--line-strong)',
            }}
          >
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border"
              style={{
                background: applyNow ? 'var(--p-1)' : 'transparent',
                borderColor: applyNow ? 'var(--p-1)' : 'var(--line-strong)',
                color: '#fff',
              }}
            >
              {applyNow && <Check size={13} />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">Apply to {guildName} now</span>
              <span className="mt-0.5 block text-xs" style={{ color: 'var(--text-3)' }}>
                Writes these settings to your server right away. Channel and role references are
                checked against this server; new roles are created where needed.
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
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full text-[11px]"
              style={{
                background: active || done ? 'var(--p-1)' : 'var(--bg-2)',
                color: active || done ? '#fff' : 'var(--text-3)',
              }}
            >
              {done ? <Check size={12} /> : i + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </span>
        )
      })}
    </div>
  )
}
