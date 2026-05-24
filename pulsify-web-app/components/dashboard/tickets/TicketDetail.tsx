'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Hash,
  Hand,
  Undo2,
  UserPlus,
  UserMinus,
  PenLine,
  StickyNote,
  Lock,
  RotateCcw,
  Trash2,
  Download,
  ExternalLink,
  Loader2,
  UserCog,
} from 'lucide-react'
import { ConfirmDialog, type FieldDef, type ConfirmTone } from '@/components/ui/confirm-dialog'
import {
  PRIORITY_META,
  PRIORITIES,
  EVENT_META,
  timeAgo,
  type Ticket,
  type TicketEvent,
  type TicketPriority,
} from '@/lib/tickets'
import type { ActionResult } from '@/app/dashboard/[guildId]/tickets/actions'
import {
  claimTicket,
  unclaimTicket,
  assignTicket,
  setTicketPriority,
  addTicketNote,
  renameTicketChannel,
  addTicketUser,
  removeTicketUser,
  closeTicket,
  reopenTicket,
  deleteTicket,
  getTicketEvents,
  getTicketTranscript,
} from '@/app/dashboard/[guildId]/tickets/actions'
import { StatusBadge } from './badges'
import { TicketIcon } from './icons'

type RunAction = <T>(fn: () => Promise<ActionResult<T>>, successMsg?: string) => Promise<ActionResult<T>>

type Props = {
  guildId: string
  ticket: Ticket
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

export function TicketDetail({ guildId, ticket, onClose, runAction }: Props) {
  const [events, setEvents] = useState<TicketEvent[] | null>(null)
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const reloadEvents = useCallback(async () => {
    const res = await getTicketEvents(guildId, ticket.id)
    if (res.ok) setEvents(res.data.events as TicketEvent[])
  }, [guildId, ticket.id])

  // Load the timeline on open. setState happens in the promise callback (not
  // synchronously in the effect body), satisfying react-hooks/set-state-in-effect.
  useEffect(() => {
    let active = true
    getTicketEvents(guildId, ticket.id).then((res) => {
      if (active && res.ok) setEvents(res.data.events as TicketEvent[])
    })
    return () => {
      active = false
    }
  }, [guildId, ticket.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !dialog) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dialog, onClose])

  // Wrap a server action: run it, reload the timeline on success.
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

  async function downloadTranscript() {
    const res = await getTicketTranscript(guildId, ticket.id)
    if (!res.ok || !res.data.transcript) return
    const blob = new Blob([res.data.transcript], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ticket-${ticket.number}-transcript.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const closed = ticket.status === 'closed'
  const discordUrl = ticket.channel_id
    ? `https://discord.com/channels/${guildId}/${ticket.channel_id}`
    : null

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[55] flex justify-end"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)' }}
      onClick={() => !dialog && onClose()}
    >
      <aside
        className="ticket-drawer flex h-full w-full max-w-xl flex-col border-l shadow-2xl"
        style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start gap-3 border-b px-5 py-4"
          style={{ borderColor: 'var(--line-strong)' }}
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            <Hash size={13} />
            {ticket.number}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-semibold text-foreground">
                {ticket.subject || ticket.type_label || 'Ticket'}
              </h2>
              <StatusBadge status={ticket.status} />
            </div>
            <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-3)' }}>
              {ticket.type_label ?? 'Ticket'} · opened by {ticket.opener_name ?? 'a member'} · {timeAgo(ticket.opened_at)}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground transition hover:text-foreground" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3">
            <Meta label="Assigned to" value={ticket.claimed_by_name ?? 'Unclaimed'} />
            <Meta
              label="Priority"
              value={
                <span style={{ color: PRIORITY_META[ticket.priority].color }} className="font-semibold">
                  {PRIORITY_META[ticket.priority].label}
                </span>
              }
            />
            <Meta label="Opened" value={new Date(ticket.opened_at).toLocaleString()} />
            <Meta
              label={closed ? 'Closed' : 'Last activity'}
              value={
                closed && ticket.closed_at
                  ? new Date(ticket.closed_at).toLocaleString()
                  : timeAgo(ticket.last_activity_at)
              }
            />
          </div>

          {ticket.close_reason && (
            <div
              className="mt-3 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-2)' }}
            >
              <span className="font-medium" style={{ color: 'var(--text-3)' }}>Close reason: </span>
              {ticket.close_reason}
            </div>
          )}

          {/* Form answers */}
          {ticket.form_answers.length > 0 && (
            <div className="mt-5">
              <SectionLabel>Submission</SectionLabel>
              <div
                className="space-y-3 rounded-xl border p-4"
                style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
              >
                {ticket.form_answers.map((a, i) => (
                  <div key={i}>
                    <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{a.label}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{a.value || '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="mt-5">
            <SectionLabel>Manage</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {!closed && (
                ticket.claimed_by ? (
                  <ActionBtn icon={<Undo2 size={14} />} label="Unclaim" onClick={() => run(() => unclaimTicket(guildId, ticket.id), 'Ticket unclaimed')} />
                ) : (
                  <ActionBtn icon={<Hand size={14} />} label="Claim" onClick={() => run(() => claimTicket(guildId, ticket.id), 'Ticket claimed')} />
                )
              )}
              {!closed && (
                <ActionBtn
                  icon={<UserCog size={14} />}
                  label="Assign"
                  onClick={() =>
                    setDialog({
                      title: 'Assign ticket',
                      description: 'Assign this ticket to a staff member by their Discord user ID.',
                      confirmLabel: 'Assign',
                      fields: [{ key: 'userId', kind: 'text', label: 'Discord user ID', placeholder: '123456789012345678', required: true }],
                      run: (v) => assignTicket(guildId, ticket.id, v.userId),
                    })
                  }
                />
              )}
              {!closed && (
                <ActionBtn
                  icon={<PenLine size={14} />}
                  label="Rename"
                  onClick={() =>
                    setDialog({
                      title: 'Rename channel',
                      confirmLabel: 'Rename',
                      fields: [{ key: 'name', kind: 'text', label: 'New channel name', placeholder: 'ticket-42', required: true, maxLength: 90 }],
                      run: (v) => renameTicketChannel(guildId, ticket.id, v.name),
                    })
                  }
                />
              )}
              {!closed && (
                <ActionBtn
                  icon={<UserPlus size={14} />}
                  label="Add user"
                  onClick={() =>
                    setDialog({
                      title: 'Add user to ticket',
                      confirmLabel: 'Add',
                      fields: [{ key: 'userId', kind: 'text', label: 'Discord user ID', placeholder: '123456789012345678', required: true }],
                      run: (v) => addTicketUser(guildId, ticket.id, v.userId),
                    })
                  }
                />
              )}
              {!closed && ticket.participants.length > 0 && (
                <ActionBtn
                  icon={<UserMinus size={14} />}
                  label="Remove user"
                  onClick={() =>
                    setDialog({
                      title: 'Remove user from ticket',
                      confirmLabel: 'Remove',
                      tone: 'warning',
                      fields: [
                        {
                          key: 'userId',
                          kind: 'select',
                          label: 'Added user',
                          options: ticket.participants.map((p) => ({ label: p, value: p })),
                          defaultValue: ticket.participants[0],
                        },
                      ],
                      run: (v) => removeTicketUser(guildId, ticket.id, v.userId),
                    })
                  }
                />
              )}
              <ActionBtn
                icon={<StickyNote size={14} />}
                label="Add note"
                onClick={() =>
                  setDialog({
                    title: 'Internal note',
                    description: 'Visible only to staff on the dashboard timeline — not posted to Discord.',
                    confirmLabel: 'Save note',
                    fields: [{ key: 'note', kind: 'textarea', label: 'Note', placeholder: 'Context for the team…', required: true, maxLength: 1000 }],
                    run: (v) => addTicketNote(guildId, ticket.id, v.note),
                  })
                }
              />
              {ticket.has_transcript && (
                <ActionBtn icon={<Download size={14} />} label="Transcript" onClick={downloadTranscript} />
              )}
              {discordUrl && (
                <a
                  href={discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors"
                  style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                >
                  <ExternalLink size={14} /> Open in Discord
                </a>
              )}
            </div>

            {/* Priority picker */}
            {!closed && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>Priority</span>
                {PRIORITIES.map((p) => (
                  <PriorityChip
                    key={p}
                    priority={p}
                    active={ticket.priority === p}
                    onClick={() => run(() => setTicketPriority(guildId, ticket.id, p))}
                  />
                ))}
              </div>
            )}

            {/* Lifecycle */}
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: 'var(--line-strong)' }}>
              {closed ? (
                <ActionBtn icon={<RotateCcw size={14} />} label="Reopen" tone="success" onClick={() => run(() => reopenTicket(guildId, ticket.id), 'Ticket reopened')} />
              ) : (
                <ActionBtn
                  icon={<Lock size={14} />}
                  label="Close ticket"
                  tone="primary"
                  onClick={() =>
                    setDialog({
                      title: `Close ticket #${ticket.number}`,
                      description: 'The channel is locked and a transcript is captured.',
                      confirmLabel: 'Close ticket',
                      fields: [{ key: 'reason', kind: 'textarea', label: 'Reason (optional)', placeholder: 'Resolved — …', maxLength: 500 }],
                      run: (v) => closeTicket(guildId, ticket.id, v.reason ?? ''),
                    })
                  }
                />
              )}
              <ActionBtn
                icon={<Trash2 size={14} />}
                label="Delete"
                tone="destructive"
                onClick={() =>
                  setDialog({
                    title: `Delete ticket #${ticket.number}?`,
                    description: 'This permanently deletes the Discord channel and the ticket record. This cannot be undone.',
                    confirmLabel: 'Delete permanently',
                    tone: 'destructive',
                    run: async () => {
                      const res = await deleteTicket(guildId, ticket.id)
                      if (res.ok) onClose()
                      return res
                    },
                  })
                }
              />
            </div>
          </div>

          {/* Timeline */}
          <div className="mt-6">
            <SectionLabel>Activity</SectionLabel>
            {events === null ? (
              <div className="flex items-center gap-2 py-4 text-sm" style={{ color: 'var(--text-3)' }}>
                <Loader2 size={14} className="animate-spin" /> Loading timeline…
              </div>
            ) : events.length === 0 ? (
              <p className="py-3 text-sm" style={{ color: 'var(--text-3)' }}>No activity recorded yet.</p>
            ) : (
              <ol className="space-y-3">
                {events.map((e) => {
                  const meta = EVENT_META[e.type] ?? EVENT_META.note
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

type Tone = 'default' | 'primary' | 'success' | 'destructive'
const TONE: Record<Tone, React.CSSProperties> = {
  default: { borderColor: 'var(--line-strong)', color: 'var(--text-2)' },
  primary: { borderColor: 'var(--p-1)', color: 'var(--p-1)', background: 'var(--p-soft)' },
  success: { borderColor: 'rgba(34,197,94,0.4)', color: '#4ade80', background: 'rgba(34,197,94,0.08)' },
  destructive: { borderColor: 'rgba(239,68,68,0.4)', color: '#f87171', background: 'rgba(239,68,68,0.08)' },
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

function PriorityChip({ priority, active, onClick }: { priority: TicketPriority; active: boolean; onClick: () => void }) {
  const meta = PRIORITY_META[priority]
  return (
    <button
      onClick={onClick}
      className="rounded-md px-2 py-1 text-[11px] font-semibold transition-all"
      style={
        active
          ? { color: meta.color, background: `color-mix(in srgb, ${meta.color} 16%, transparent)`, boxShadow: `inset 0 0 0 1px ${meta.color}` }
          : { color: 'var(--text-3)', background: 'var(--bg-2)' }
      }
    >
      {meta.label}
    </button>
  )
}
