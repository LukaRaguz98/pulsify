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
  ArrowLeft,
  Sparkles,
} from 'lucide-react'
import {
  SECTION_META,
  sectionKeysPresent,
  summarizeSection,
  type ServerTemplate,
  type TemplateSectionKey,
  type TemplateRole,
} from '@/lib/templates'
import { applyTemplate, type ApplySummary } from '@/app/dashboard/[guildId]/templates/actions'
import type { GuildConfigSnapshot } from '@/app/dashboard/[guildId]/templates/page'
import { Modal } from './Modal'
import { TemplateIcon } from './icons'

type Props = {
  guildId: string
  guildName: string
  template: ServerTemplate
  snapshot: GuildConfigSnapshot
  onClose: () => void
}

type Step = 'select' | 'result'

export function TemplateApplyWizard({ guildId, guildName, template, snapshot, onClose }: Props) {
  const router = useRouter()
  const present = useMemo(() => sectionKeysPresent(template.sections), [template])
  const [selected, setSelected] = useState<Set<TemplateSectionKey>>(() => new Set(present))
  const [step, setStep] = useState<Step>('select')
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ApplySummary | null>(null)

  const presentTargets = new Set(snapshot.presentSections)

  // Role conflict preview — how many template roles already exist by name.
  const roleConflicts = useMemo(() => {
    const roles = (template.sections.roles ?? []) as TemplateRole[]
    if (!roles.length) return null
    const existing = new Set(snapshot.roleNames)
    const dupes = roles.filter((r) => existing.has(r.name.toLowerCase())).length
    return { total: roles.length, dupes, fresh: roles.length - dupes }
  }, [template, snapshot.roleNames])

  function toggle(key: TemplateSectionKey) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function onApply() {
    if (selected.size === 0) {
      setError('Select at least one section to apply.')
      return
    }
    setApplying(true)
    setError(null)
    const res = await applyTemplate(guildId, {
      templateId: template.builtin ? undefined : template.id,
      builtinId: template.builtin ? template.id : undefined,
      sectionKeys: [...selected],
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

  const overwriteCount = [...selected].filter((k) => presentTargets.has(k)).length

  return (
    <Modal
      title={step === 'result' ? 'Template applied' : `Apply "${template.name}"`}
      subtitle={
        step === 'result'
          ? `Changes are live on ${guildName}.`
          : 'Choose what to apply and review the changes first.'
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
              Apply {selected.size} section{selected.size === 1 ? '' : 's'}
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
          {overwriteCount > 0 && (
            <div
              className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
              style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#fbbf24' }}
            >
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                {overwriteCount} selected section{overwriteCount === 1 ? '' : 's'} will{' '}
                <strong>overwrite</strong> existing settings on {guildName}.
              </span>
            </div>
          )}

          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            Tick the parts you want to apply — partial imports are supported.
          </p>

          <div className="space-y-2">
            {present.map((key) => {
              const meta = SECTION_META[key]
              const checked = selected.has(key)
              const willOverwrite = presentTargets.has(key)
              const bullets =
                key === 'roles'
                  ? summarizeSection(key, template.sections.roles)
                  : summarizeSection(key, template.sections[key])
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(key)}
                  className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors"
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
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <span style={{ color: meta.accent }}>
                          <TemplateIcon name={meta.icon} size={13} />
                        </span>
                        {meta.label}
                      </span>
                      <span
                        className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                        style={
                          willOverwrite
                            ? { background: 'rgba(245,158,11,0.16)', color: '#fbbf24' }
                            : { background: 'rgba(34,197,94,0.16)', color: '#4ade80' }
                        }
                      >
                        {willOverwrite ? 'Overwrites' : 'New'}
                      </span>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
                      {bullets.map((b, i) => (
                        <span key={i}>
                          {b}
                          {i < bullets.length - 1 ? ' ·' : ''}
                        </span>
                      ))}
                    </span>
                    {key === 'roles' && roleConflicts && (
                      <span className="mt-1 block text-xs" style={{ color: 'var(--text-3)' }}>
                        {roleConflicts.fresh} new · {roleConflicts.dupes} already exist (skipped)
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>

          <div
            className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs"
            style={{ borderColor: 'var(--line)', background: 'var(--bg-2)', color: 'var(--text-3)' }}
          >
            <Sparkles size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--p-1)' }} />
            <span>
              Channel and role references that do not exist on {guildName} are cleared automatically — you
              reselect them in each feature. New roles are created safely with no permissions.
            </span>
          </div>
        </div>
      )}

      {step === 'result' && summary && (
        <div className="space-y-4">
          <div className="space-y-2">
            {summary.applied.map((a) => {
              const meta = SECTION_META[a.key]
              return (
                <div
                  key={a.key}
                  className="flex items-center gap-3 rounded-lg border p-3"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: 'rgba(34,197,94,0.14)', color: '#4ade80' }}
                  >
                    <Check size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <span style={{ color: meta.accent }}>
                        <TemplateIcon name={meta.icon} size={12} />
                      </span>
                      {a.label}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                      {a.detail}
                    </p>
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

          <button
            onClick={() => {
              setStep('select')
              setSummary(null)
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium"
            style={{ color: 'var(--text-3)' }}
          >
            <ArrowLeft size={12} /> Apply more sections
          </button>
        </div>
      )}
    </Modal>
  )
}
