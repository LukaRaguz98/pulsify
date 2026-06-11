'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import {
  X,
  Hash,
  User,
  CheckCircle2,
  XCircle,
  HelpCircle,
  StickyNote,
  UserCog,
  UserMinus,
  Loader2,
} from 'lucide-react'
import { ConfirmDialog, type FieldDef, type ConfirmTone } from '@/components/ui/confirm-dialog'
import {
  APPLICATION_EVENT_META,
  APPLICATION_STATUS_META,
  applicationTypeDisplay,
  applicantAvatarUrl,
  timeAgo,
  type Application,
  type ApplicationEvent,
} from '@/lib/applications'
import type { ActionResult } from '@/app/dashboard/[guildId]/(management)/tickets/actions'
import {
  setApplicationStatus,
  assignApplicationReviewer,
  clearApplicationReviewer,
  addApplicationNote,
  getApplicationEvents,
} from '@/app/dashboard/[guildId]/applications-actions'
import { ApplicationStatusBadge } from './badges'
import { TicketIcon } from './icons'

type RunAction = <T>(fn: () => Promise<ActionResult<T>>, successMsg?: string) => Promise<ActionResult<T>>

type Props = {
  guildId: string
  application: Application
  onClose: () => void
  runAction: RunAction
}

type DialogSpec = {
  title: string
  description?: string
  confirmLabel: string
  tone?: ConfirmTone
  fields?: FieldDef[]
  run: (values: Record<string, string>) => Promise<ActionResult>
}

export function ApplicationDetail({ guildId, application, onClose, runAction }: Props) {
  const [events, setEvents] = useState<ApplicationEvent[] | null>(null)
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const reloadEvents = useCallback(async () => {
    const res = await getApplicationEvents(guildId, application.id)
    if (res.ok) setEvents(res.data.events)
  }, [guildId, application.id])

  useEffect(() => {
    let active = true
    getApplicationEvents(guildId, application.id).then((res) => {
      if (active && res.ok) setEvents(res.data.events)
    })
    return () => {
      active = false
    }
  }, [guildId, application.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !dialog) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dialog, onClose])

  const run = useCallback(
    async <T,>(fn: () => Promise<ActionResult<T>>, successMsg?: string): Promise<ActionResult<T>> => {
      const res = await runAction(fn, successMsg)
      if (res.ok) void reloadEvents()
      return res
    },
    [runAction, reloadEvents],
  )

  async function confirmDialog(values: Record<string, string>) {
    if (!dialog) return
    setBusy(true)
    setDialogError(null)
    const res = await run(dialog.run.bind(null, values))
    setBusy(false)
    if (res.ok) setDialog(null)
    else setDialogError(res.error)
  }

  const display = applicationTypeDisplay(application)
  const avatar = applicantAvatarUrl(application.applicant_id, application.applicant_avatar)
  const decided = application.status === 'approved' || application.status === 'rejected'

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !dialog && onClose()}
    >
      <aside
        className="relative flex w-full max-w-2xl max-h-[90vh] flex-col rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-bold"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            {avatar ? (
              <Image src={avatar} alt="" width={40} height={40} className="h-full w-full object-cover" unoptimized />
            ) : (
              <User size={16} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-semibold text-foreground">{application.applicant_name ?? 'A member'}</h2>
              <ApplicationStatusBadge status={application.status} />
            </div>
            <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-3)' }}>
              <span className="inline-flex items-center gap-0.5"><Hash size={11} />{application.number}</span>
              {' · '}applying for <span className="font-medium text-foreground">{display}</span>
              {' · '}{timeAgo(application.created_at)}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground transition hover:text-foreground" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3">
            <Meta label="Applying for" value={display} />
            <Meta label="Reviewer" value={application.reviewer_name ?? 'Unassigned'} />
            <Meta label="Submitted" value={new Date(application.created_at).toLocaleString()} />
            <Meta
              label="Decision"
              value={
                decided && application.decided_at
                  ? `${APPLICATION_STATUS_META[application.status].label} · ${new Date(application.decided_at).toLocaleDateString()}`
                  : '—'
              }
            />
          </div>

          {application.decision_note && (
            <div
              className="mt-3 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-2)' }}
            >
              <span className="font-medium" style={{ color: 'var(--text-3)' }}>Decision note: </span>
              {application.decision_note}
            </div>
          )}

          {/* Application message */}
          <div className="mt-5">
            <SectionLabel>Application</SectionLabel>
            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
              <p className="whitespace-pre-wrap text-sm text-foreground">{application.message || '—'}</p>
              {application.answers.length > 0 && (
                <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: 'var(--line-strong)' }}>
                  {application.answers.map((a, i) => (
                    <div key={i}>
                      <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{a.label}</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{a.value || '—'}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Review actions */}
          <div className="mt-5">
            <SectionLabel>Review</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <ActionBtn
                icon={<CheckCircle2 size={14} />}
                label="Approve"
                tone="success"
                onClick={() =>
                  setDialog({
                    title: `Approve application #${application.number}?`,
                    description: 'The applicant is notified by DM. Add an optional note they will see.',
                    confirmLabel: 'Approve',
                    tone: 'default',
                    fields: [{ key: 'note', kind: 'textarea', label: 'Note to applicant (optional)', placeholder: 'Welcome to the team!…', maxLength: 1000 }],
                    run: (v) => setApplicationStatus(guildId, application.id, 'approved', v.note),
                  })
                }
              />
              <ActionBtn
                icon={<XCircle size={14} />}
                label="Reject"
                tone="destructive"
                onClick={() =>
                  setDialog({
                    title: `Reject application #${application.number}?`,
                    description: 'The applicant is notified by DM. Add an optional reason they will see.',
                    confirmLabel: 'Reject',
                    tone: 'destructive',
                    fields: [{ key: 'note', kind: 'textarea', label: 'Reason (optional)', placeholder: 'Thanks for applying — …', maxLength: 1000 }],
                    run: (v) => setApplicationStatus(guildId, application.id, 'rejected', v.note),
                  })
                }
              />
              <ActionBtn
                icon={<HelpCircle size={14} />}
                label="Request info"
                onClick={() =>
                  setDialog({
                    title: 'Request more information',
                    description: 'Mark the application as needing more info. The applicant is DM’d your message.',
                    confirmLabel: 'Request info',
                    fields: [{ key: 'note', kind: 'textarea', label: 'What do you need?', placeholder: 'Could you tell us more about…', required: true, maxLength: 1000 }],
                    run: (v) => setApplicationStatus(guildId, application.id, 'needs_info', v.note),
                  })
                }
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <ActionBtn
                icon={<UserCog size={14} />}
                label={application.reviewer_id ? 'Reassign reviewer' : 'Assign reviewer'}
                onClick={() =>
                  setDialog({
                    title: 'Assign reviewer',
                    description: 'Assign a staff member to review this application by their Discord user ID.',
                    confirmLabel: 'Assign',
                    fields: [{ key: 'userId', kind: 'text', label: 'Discord user ID', placeholder: '123456789012345678', required: true }],
                    run: (v) => assignApplicationReviewer(guildId, application.id, v.userId),
                  })
                }
              />
              {application.reviewer_id && (
                <ActionBtn
                  icon={<UserMinus size={14} />}
                  label="Clear reviewer"
                  tone="warning"
                  onClick={() => run(() => clearApplicationReviewer(guildId, application.id), 'Reviewer cleared')}
                />
              )}
              <ActionBtn
                icon={<StickyNote size={14} />}
                label="Add note"
                onClick={() =>
                  setDialog({
                    title: 'Internal note',
                    description: 'Visible only to staff on this timeline — never sent to the applicant.',
                    confirmLabel: 'Save note',
                    fields: [{ key: 'note', kind: 'textarea', label: 'Note', placeholder: 'Context for the team…', required: true, maxLength: 1000 }],
                    run: (v) => addApplicationNote(guildId, application.id, v.note),
                  })
                }
              />
            </div>
          </div>

          {/* Timeline */}
          <div className="mt-6">
            <SectionLabel>Review history</SectionLabel>
            {events === null ? (
              <div className="flex items-center gap-2 py-4 text-sm" style={{ color: 'var(--text-3)' }}>
                <Loader2 size={14} className="animate-spin" /> Loading history…
              </div>
            ) : events.length === 0 ? (
              <p className="py-3 text-sm" style={{ color: 'var(--text-3)' }}>No history recorded yet.</p>
            ) : (
              <ol className="space-y-3">
                {events.map((e) => {
                  const meta = APPLICATION_EVENT_META[e.type] ?? APPLICATION_EVENT_META.note
                  return (
                    <li key={e.id} className="flex gap-3">
                      <span
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                        style={{ background: `color-mix(in srgb, ${meta.accent} 14%, transparent)`, color: meta.accent }}
                      >
                        <TicketIcon name={meta.icon} size={13} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground">
                          <span className="font-medium">{meta.label}</span>
                          {e.detail ? <span style={{ color: 'var(--text-2)' }}> — {e.detail}</span> : null}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                          {e.actor_name ? `${e.actor_name} · ` : ''}{timeAgo(e.created_at)}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </div>
      </aside>

      {dialog && (
        <ConfirmDialog
          title={dialog.title}
          description={dialog.description}
          confirmLabel={dialog.confirmLabel}
          tone={dialog.tone}
          fields={dialog.fields}
          busy={busy}
          error={dialogError}
          onCancel={() => { if (!busy) { setDialog(null); setDialogError(null) } }}
          onConfirm={confirmDialog}
        />
      )}
    </div>,
    document.body,
  )
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
      <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="mt-0.5 truncate text-sm text-foreground">{value}</p>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{children}</p>
}

type Tone = 'default' | 'success' | 'destructive' | 'warning'
const TONE: Record<Tone, React.CSSProperties> = {
  default: { borderColor: 'var(--line-strong)', color: 'var(--text-2)' },
  success: { borderColor: 'rgba(34,197,94,0.4)', color: '#4ade80', background: 'rgba(34,197,94,0.08)' },
  destructive: { borderColor: 'rgba(239,68,68,0.4)', color: '#f87171', background: 'rgba(239,68,68,0.08)' },
  warning: { borderColor: 'rgba(245,158,11,0.4)', color: '#f59e0b', background: 'rgba(245,158,11,0.08)' },
}

function ActionBtn({ icon, label, onClick, tone = 'default' }: { icon: React.ReactNode; label: string; onClick: () => void; tone?: Tone }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors"
      style={TONE[tone]}
    >
      {icon}
      {label}
    </button>
  )
}
