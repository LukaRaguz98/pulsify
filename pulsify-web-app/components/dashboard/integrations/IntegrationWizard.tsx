'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import {
  X, AlertCircle, Loader2, Plug, Save, Send, Hash, ChevronLeft, ChevronRight,
  CheckCircle2, ShieldCheck, Bell, Sparkles, ExternalLink as LinkIcon,
} from 'lucide-react'
import {
  providerById,
  emptyDraft,
  validateDraft,
  deriveLabel,
  renderTemplate,
  sampleContext,
  notificationDetails,
  notificationLink,
  stripStandaloneUrl,
  TEMPLATE_MAX,
  type Integration,
  type IntegrationDraft,
  type IntegrationProvider,
} from '@/lib/integrations'
import {
  connectIntegration,
  updateIntegration,
  testConnection,
} from '@/app/dashboard/[guildId]/(management)/integrations/actions'
import { IntegrationIcon } from './icons'

type Channel = { id: string; name: string }

type Props = {
  guildId: string
  providerId: string
  channels: Channel[]
  /** Existing row when editing an established connection; null when connecting. */
  editing: Integration | null
  onClose: () => void
  onFeedback: (kind: 'success' | 'error', msg: string) => void
}

const FIELD_CLASS =
  'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-1'
const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

type Step = 'configure' | 'notifications' | 'review'
const STEPS: { key: Step; label: string; icon: React.ReactNode }[] = [
  { key: 'configure', label: 'Configure', icon: <ShieldCheck size={14} /> },
  { key: 'notifications', label: 'Notifications', icon: <Bell size={14} /> },
  { key: 'review', label: 'Review', icon: <Sparkles size={14} /> },
]

/** Build the initial draft, hydrating from an existing row when editing. */
function initialDraft(providerId: string, editing: Integration | null): IntegrationDraft {
  const provider = providerById(providerId)!
  const base = emptyDraft(provider)
  if (!editing) return base
  const config: Record<string, string> = {}
  for (const f of provider.fields) {
    const v = editing.config[f.key]
    if (typeof v === 'string') config[f.key] = v
  }
  const events = { ...base.events }
  const storedEvents = editing.config.events as Record<string, boolean> | undefined
  if (storedEvents) for (const k of Object.keys(events)) events[k] = storedEvents[k] ?? events[k]
  return {
    provider: providerId,
    label: editing.label,
    channel_id: editing.channel_id,
    config,
    events,
    template: editing.template ?? provider.defaultTemplate,
    enabled: editing.enabled,
  }
}

export function IntegrationWizard({ guildId, providerId, channels, editing, onClose, onFeedback }: Props) {
  const router = useRouter()
  const provider = providerById(providerId)
  const isEdit = editing !== null

  const [draft, setDraft] = useState<IntegrationDraft>(() => initialDraft(providerId, editing))
  // Edits show everything at once; new connections walk the steps.
  const [step, setStep] = useState<Step>('configure')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Escape-to-close + chrome-hide, matching every other dialog. Disabled while a
  // save or test is in flight so the panel can't be dismissed mid-request.
  const busy = saving || testing
  useDialogDismiss(onClose, busy)

  const setConfig = (key: string, value: string) =>
    setDraft((d) => ({ ...d, config: { ...d.config, [key]: value } }))
  const setEvent = (key: string, on: boolean) =>
    setDraft((d) => ({ ...d, events: { ...d.events, [key]: on } }))

  const channelName = channels.find((c) => c.id === draft.channel_id)?.name
  const previewLabel = draft.label.trim() || (provider ? deriveLabel(provider, draft.config) : '')

  // Mirror the posted embed: render the template, strip the now-redundant raw URL
  // line (the link button carries it), and surface the provider's detail fields.
  const preview = useMemo(() => {
    if (!provider) return { body: '', details: [] as { label: string; value: string }[], link: null as { label: string; url: string } | null }
    const ctx = sampleContext(provider, draft.config)
    const link = notificationLink(provider.id, ctx)
    const body = stripStandaloneUrl(renderTemplate(draft.template ?? provider.defaultTemplate, ctx), link?.url)
    return { body, details: notificationDetails(provider.id, ctx), link }
  }, [provider, draft.config, draft.template])

  if (!provider) return null

  // Per-step gate so "Next" can't advance past required fields.
  const configValid = provider.fields.every(
    (f) => !f.required || (draft.config[f.key] ?? '').trim(),
  )

  async function submit() {
    const validationError = validateDraft(draft)
    if (validationError) {
      setError(validationError)
      if (provider!.fields.some((f) => validationError.startsWith(f.label))) setStep('configure')
      return
    }
    setError(null)
    setSaving(true)
    const res = isEdit
      ? await updateIntegration(guildId, editing!.id, draft)
      : await connectIntegration(guildId, draft)
    setSaving(false)
    if (res.ok) {
      onFeedback('success', isEdit ? 'Integration updated.' : `${provider!.name} connected.`)
      router.refresh()
      onClose()
    } else {
      setError(res.error)
    }
  }

  async function onTest() {
    if (!isEdit) return
    setTesting(true)
    setError(null)
    const res = await testConnection(guildId, editing!.id)
    setTesting(false)
    if (res.ok) {
      onFeedback('success', res.data.delivered ? 'Test notification delivered to Discord.' : 'Configuration looks good.')
      router.refresh()
    } else {
      setError(res.error)
    }
  }

  const showSection = (s: Step) => isEdit || step === s

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => { if (!busy) onClose() }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        className="relative flex w-full max-w-4xl max-h-[92vh] flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${provider.accent}1f`, color: provider.accent }}>
              <IntegrationIcon name={provider.icon} size={20} />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">
                {isEdit ? `${provider.name} settings` : `Connect ${provider.name}`}
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                {isEdit ? previewLabel : provider.description}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5" style={{ color: 'var(--text-3)' }} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Stepper (new connections only) */}
        {!isEdit && (
          <div className="flex items-center gap-1 border-b px-5 py-3" style={{ borderColor: 'var(--line-strong)' }}>
            {STEPS.map((s, i) => {
              const active = s.key === step
              const done = STEPS.findIndex((x) => x.key === step) > i
              return (
                <div key={s.key} className="flex items-center gap-1">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                    style={{
                      background: active ? 'var(--p-soft)' : 'transparent',
                      color: active ? 'var(--p-1)' : done ? '#22c55e' : 'var(--text-3)',
                    }}
                  >
                    {done ? <CheckCircle2 size={14} /> : s.icon}
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 && <ChevronRight size={13} style={{ color: 'var(--text-3)' }} />}
                </div>
              )
            })}
          </div>
        )}

        <div className="grid flex-1 gap-0 overflow-hidden md:grid-cols-[3fr_2fr]">
          {/* Form */}
          <div className="flex flex-col gap-5 overflow-y-auto p-5">
            {/* Stored error from the last sync/test — shown when editing so the
                admin sees what's wrong and how to clear it. */}
            {isEdit && editing!.status === 'error' && editing!.last_error && (
              <div
                className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs"
                style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
              >
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold">This integration needs attention</p>
                  <p className="mt-0.5 break-words" style={{ color: '#fca5a5' }}>{editing!.last_error}</p>
                  <p className="mt-1" style={{ color: 'var(--text-3)' }}>
                    Fix the configuration above, then run <strong>Test connection</strong> to retry and clear the error.
                  </p>
                </div>
              </div>
            )}

            {/* ── Configure ── */}
            {showSection('configure') && (
              <section className="space-y-4">
                {isEdit && <SectionTitle icon={<ShieldCheck size={13} />} title="Configuration" />}
                {provider.fields.map((field) => (
                  <div key={field.key}>
                    <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                      {field.label}
                      {field.required && <span style={{ color: '#f87171' }}> *</span>}
                    </label>
                    {field.type === 'select' ? (
                      <select
                        value={draft.config[field.key] ?? ''}
                        onChange={(e) => setConfig(field.key, e.target.value)}
                        className={FIELD_CLASS}
                        style={fieldStyle}
                      >
                        <option value="">Choose…</option>
                        {field.options?.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type === 'secret' ? 'password' : 'text'}
                        value={draft.config[field.key] ?? ''}
                        onChange={(e) => setConfig(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        autoComplete={field.type === 'secret' ? 'new-password' : 'off'}
                        className={FIELD_CLASS}
                        style={fieldStyle}
                      />
                    )}
                    {field.help && (
                      <p className="mt-1 text-[10px]" style={{ color: 'var(--text-3)' }}>{field.help}</p>
                    )}
                  </div>
                ))}
                {provider.fields.some((f) => f.type === 'secret') && (
                  <p className="flex items-start gap-1.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
                    <ShieldCheck size={12} className="mt-0.5 shrink-0" />
                    Credentials are stored with your server configuration and only used to fetch updates for this integration.
                  </p>
                )}
              </section>
            )}

            {/* ── Notifications ── */}
            {showSection('notifications') && (
              <section className="space-y-4">
                {isEdit && <SectionTitle icon={<Bell size={13} />} title="Notifications" />}

                <div>
                  <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                    Display name
                  </label>
                  <input
                    value={draft.label}
                    onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                    placeholder={deriveLabel(provider, draft.config)}
                    className={FIELD_CLASS}
                    style={fieldStyle}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                    Destination channel
                  </label>
                  <select
                    value={draft.channel_id ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, channel_id: e.target.value || null }))}
                    className={FIELD_CLASS}
                    style={fieldStyle}
                  >
                    <option value="">No channel — configure only</option>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>#{c.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px]" style={{ color: 'var(--text-3)' }}>
                    Pulse checks it can post here before saving. Leave empty to set this up later.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                    Message template
                  </label>
                  <textarea
                    value={draft.template ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, template: e.target.value }))}
                    rows={4}
                    maxLength={TEMPLATE_MAX}
                    className={`${FIELD_CLASS} resize-y font-mono text-[13px]`}
                    style={fieldStyle}
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {provider.placeholders.map((p) => (
                      <button
                        key={p.token}
                        type="button"
                        title={p.description}
                        onClick={() => setDraft((d) => ({ ...d, template: `${d.template ?? ''}${p.token}` }))}
                        className="rounded px-1.5 py-0.5 text-[10px] font-mono transition-colors"
                        style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                      >
                        {p.token}
                      </button>
                    ))}
                  </div>
                </div>

                {provider.syncEvents && provider.syncEvents.length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                      Event synchronization
                    </label>
                    <div className="space-y-1.5 rounded-lg border p-2" style={{ borderColor: 'var(--line-strong)' }}>
                      {provider.syncEvents.map((ev) => (
                        <label key={ev.key} className="flex cursor-pointer items-start gap-2.5 rounded-md p-1.5">
                          <input
                            type="checkbox"
                            checked={draft.events[ev.key] ?? false}
                            onChange={(e) => setEvent(ev.key, e.target.checked)}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm text-foreground">{ev.label}</span>
                            <span className="block text-[11px]" style={{ color: 'var(--text-3)' }}>{ev.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-2 rounded-lg border p-3 text-xs font-semibold" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                  />
                  Notifications enabled
                </label>
              </section>
            )}

            {/* ── Review (new connections) ── */}
            {!isEdit && step === 'review' && (
              <section className="space-y-3">
                <SectionTitle icon={<Sparkles size={13} />} title="Review" />
                <ReviewRow label="Service" value={provider.name} />
                <ReviewRow label="Name" value={previewLabel} />
                {provider.refField && (
                  <ReviewRow label="Resource" value={draft.config[provider.refField] ?? '—'} />
                )}
                <ReviewRow label="Channel" value={draft.channel_id ? `#${channelName ?? draft.channel_id}` : 'None yet'} />
                <ReviewRow label="Status" value={draft.enabled ? 'Enabled' : 'Paused'} />
                <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  Connecting saves this configuration. Use <strong>Test</strong> afterwards to send a sample notification and confirm everything works.
                </p>
              </section>
            )}

            {error && (
              <div
                className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
              >
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Live preview */}
          <div className="flex flex-col overflow-y-auto border-t p-5 md:border-l md:border-t-0" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
            {/* No "Preview" heading — the Discord-style mock speaks for itself. */}
            <NotificationPreview provider={provider} label={previewLabel} body={preview.body} details={preview.details} link={preview.link} />
            <p className="mt-3 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
              <Hash size={11} /> Posts to <span style={{ color: 'var(--text-2)' }}>#{channelName ?? '—'}</span>
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 border-t p-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div>
            {isEdit && (
              <button
                onClick={onTest}
                disabled={testing || saving}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium disabled:opacity-60"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              >
                {testing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Test connection
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isEdit && step !== 'configure' && (
              <button
                onClick={() => setStep(step === 'review' ? 'notifications' : 'configure')}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              >
                <ChevronLeft size={15} /> Back
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg border px-3.5 py-2 text-sm font-medium"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              Cancel
            </button>

            {!isEdit && step !== 'review' ? (
              <button
                onClick={() => {
                  if (step === 'configure') {
                    if (!configValid) { setError('Fill in the required fields first.'); return }
                    setError(null)
                    setStep('notifications')
                  } else {
                    setStep('review')
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
              >
                Next <ChevronRight size={15} />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : isEdit ? <Save size={15} /> : <Plug size={15} />}
                {isEdit ? 'Save changes' : 'Connect'}
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-2)' }}>
      <span style={{ color: 'var(--text-3)' }}>{icon}</span>
      {title}
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line-strong)' }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className="truncate font-medium text-foreground">{value}</span>
    </div>
  )
}

/** Faithful-enough preview of the rich Pulse v2 integration notification embed. */
function NotificationPreview({
  provider,
  label,
  body,
  details,
  link,
}: {
  provider: IntegrationProvider
  label: string
  body: string
  details: { label: string; value: string }[]
  link: { label: string; url: string } | null
}) {
  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{ background: 'var(--panel)', borderLeft: `4px solid ${provider.accent}`, boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
    >
      <div className="flex items-start gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold" style={{ color: 'var(--text-2)' }}>Pulse</p>
          <p className="mt-0.5 break-words text-base font-bold leading-snug text-foreground">
            {label || provider.name}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{provider.name} · Integration</p>
          <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>just now</p>
          <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {body.trim() || 'Your notification will appear here…'}
          </div>

          {details.length > 0 && (
            <div className="mt-3 space-y-1 border-t pt-2.5" style={{ borderColor: 'var(--line-strong)' }}>
              {details.map((d) => (
                <p key={d.label} className="break-words text-[13px]" style={{ color: 'var(--text-2)' }}>
                  <span className="font-bold text-foreground">{d.label}</span>{'  '}
                  <span>{d.value}</span>
                </p>
              ))}
            </div>
          )}

          {link && (
            <div className="mt-3">
              <span
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium"
                style={{ background: 'var(--bg-2)', color: 'var(--text)', border: '1px solid var(--line-strong)' }}
              >
                <LinkIcon size={12} /> {link.label}
              </span>
            </div>
          )}

          <div className="mt-3 border-t pt-2 text-[11px]" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
            Pulse · Integrations
          </div>
        </div>
        {/* No badge thumbnail — the posted notification doesn't carry one either
            (PULSE_BADGES_ENABLED in lib/pulse-icon.ts). */}
      </div>
    </div>
  )
}
