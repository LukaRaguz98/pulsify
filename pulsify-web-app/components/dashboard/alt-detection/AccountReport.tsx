'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Link2Off,
  MessageSquare,
  Mic,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  INVESTIGATION_STATUSES,
  STATUS_META,
  type AltInvestigationEvent,
  type AltLink,
  type AltRiskAssessment,
  type InvestigationStatus,
  type LinkedAccount,
} from '@/lib/alt-detection'
import {
  addInvestigationNote,
  linkAccounts,
  openInvestigation,
  setInvestigationStatus,
  unlinkAccounts,
} from '@/app/dashboard/[guildId]/(management)/alt-detection/actions'
import { AccountChip, ConfidenceMeter, RiskBadge, ScoreRing, StatusPill, TimeAgo } from './risk-ui'

/** Mirrors AccountReport in lib/alt-detection-server (the API's payload). */
export type Report = {
  account: {
    userId: string
    username: string
    displayName: string
    avatar: string
    isMember: boolean
    accountCreatedAt: string | null
    joinedAt: string | null
    roles: { id: string; name: string; color: string }[]
    status: 'member' | 'left' | 'banned' | 'timed_out'
  }
  risk: AltRiskAssessment
  activity: { messages: number; voiceSeconds: number; lastActive: string | null }
  linked: LinkedAccount[]
  investigation: {
    id: string
    status: InvestigationStatus
    risk_score: number
    resolution: string | null
    opened_by_name: string | null
    created_at: string
  } | null
  links: AltLink[]
}

const STATUS_LABEL: Record<Report['account']['status'], { label: string; color: string }> = {
  member: { label: 'In server', color: '#34d399' },
  left: { label: 'Not in server', color: '#94a3b8' },
  banned: { label: 'Banned', color: '#f87171' },
  timed_out: { label: 'Timed out', color: '#fbbf24' },
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown'
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function ageLabel(iso: string | null): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'} ago`
  const years = Math.floor(days / 365)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

export function AccountReportView({
  guildId,
  report,
  timeline,
  onChanged,
}: {
  guildId: string
  report: Report
  timeline: AltInvestigationEvent[]
  /** Re-fetch the report after a write (the score + case both move). */
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [closing, setClosing] = useState<InvestigationStatus | null>(null)
  const [unlinking, setUnlinking] = useState<AltLink | null>(null)

  const { account, risk, activity, linked, investigation, links } = report
  const status = STATUS_LABEL[account.status]

  const linkedIds = new Set(
    links.flatMap((l) => [l.user_id, l.linked_user_id]).filter((id) => id !== account.userId),
  )

  const run = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(true)
    setError(null)
    const res = await fn()
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return false
    }
    startTransition(onChanged)
    return true
  }

  const handleOpenCase = () =>
    run(() =>
      openInvestigation(
        guildId,
        { userId: account.userId, userName: account.displayName },
        {
          score: risk.score,
          level: risk.level,
          signals: risk.signals.filter((s) => s.tone === 'risk').map((s) => s.id),
        },
      ),
    )

  const handleStatus = async (next: InvestigationStatus) => {
    if (STATUS_META[next].resolved) {
      setClosing(next)
      return
    }
    await run(() => setInvestigationStatus(guildId, account.userId, next))
  }

  const handleConfirmClose = async (resolution: string) => {
    if (!closing) return
    const ok = await run(() => setInvestigationStatus(guildId, account.userId, closing, resolution))
    if (ok) setClosing(null)
  }

  const handleNote = async () => {
    if (!note.trim()) return
    const ok = await run(() => addInvestigationNote(guildId, account.userId, note))
    if (ok) setNote('')
  }

  const handleLink = (candidate: LinkedAccount) =>
    run(() =>
      linkAccounts(
        guildId,
        { userId: account.userId, userName: account.displayName },
        { userId: candidate.userId, userName: candidate.displayName ?? candidate.username },
        {
          confidence: 100,
          indicators: candidate.indicators,
          note: `Linked from a ${candidate.confidence}% potential match.`,
        },
      ),
    )

  const handleUnlink = async () => {
    if (!unlinking) return
    const ok = await run(() => unlinkAccounts(guildId, unlinking.id))
    if (ok) setUnlinking(null)
  }

  const working = busy || pending

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
          style={{ background: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.4)', color: '#f87171' }}
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Account summary + score ────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <section className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <AccountChip
              avatar={account.avatar}
              name={account.displayName}
              subtitle={`@${account.username}`}
              size={52}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: `${status.color}1f`, color: status.color }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.color }} />
                {status.label}
              </span>
              {investigation && <StatusPill status={investigation.status} />}
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Field label="Discord ID">
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(account.userId)}
                className="inline-flex items-center gap-1 font-mono text-xs transition-colors hover:text-foreground"
                style={{ color: 'var(--text-2)' }}
                title="Copy ID"
              >
                {account.userId}
                <Copy size={11} />
              </button>
            </Field>
            <Field label="Account created">
              <span title={account.accountCreatedAt ?? undefined}>
                {formatDate(account.accountCreatedAt)}
                <span className="ml-1 text-subtle">({ageLabel(account.accountCreatedAt)})</span>
              </span>
            </Field>
            <Field label="Joined server">
              {account.joinedAt ? (
                <span title={account.joinedAt}>
                  {formatDate(account.joinedAt)}
                  <span className="ml-1 text-subtle">({ageLabel(account.joinedAt)})</span>
                </span>
              ) : (
                <span className="text-subtle">Not a member</span>
              )}
            </Field>
            <Field label="Messages">
              <span className="inline-flex items-center gap-1.5">
                <MessageSquare size={12} style={{ color: 'var(--text-3)' }} />
                {activity.messages.toLocaleString()}
              </span>
            </Field>
            <Field label="Voice">
              <span className="inline-flex items-center gap-1.5">
                <Mic size={12} style={{ color: 'var(--text-3)' }} />
                {Math.round(activity.voiceSeconds / 3600)}h
              </span>
            </Field>
            <Field label="Last active">
              <TimeAgo iso={activity.lastActive} />
            </Field>
          </dl>

          <div className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
              Roles
            </p>
            {account.roles.length === 0 ? (
              <p className="text-sm text-subtle">No roles</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {account.roles.map((role) => (
                  <span
                    key={role.id}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px]"
                    style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: role.color }} />
                    {role.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {account.isMember && (
            <Link
              href={`/dashboard/${guildId}/members/${account.userId}`}
              className="mt-5 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <UserRound size={12} /> Open member profile
              <ExternalLink size={11} />
            </Link>
          )}
        </section>

        {/* Score + recommendation */}
        <section
          className="flex flex-col items-center rounded-xl border p-5 text-center"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
            Alt risk score
          </p>
          <ScoreRing score={risk.score} level={risk.level} />
          <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {risk.recommendation}
          </p>
          <p className="mt-3 text-[11px]" style={{ color: 'var(--text-3)' }}>
            A score, not a verdict — it weighs signals Pulse can see, and it can be wrong.
          </p>
        </section>
      </div>

      {/* ── Signals ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <h2 className="mb-1 font-semibold text-foreground">Risk factors</h2>
        <p className="mb-4 text-sm" style={{ color: 'var(--text-3)' }}>
          Every signal that moved the score, and by how much.
        </p>
        <div className="space-y-2">
          {risk.signals.map((signal) => {
            const risky = signal.tone === 'risk'
            const color = risky ? '#fb923c' : '#34d399'
            return (
              <div
                key={signal.id}
                className="flex items-start gap-3 rounded-lg border px-3 py-2.5"
                style={{ borderColor: 'var(--line)', background: 'var(--bg-2)' }}
              >
                <span className="mt-0.5 shrink-0" style={{ color }}>
                  {risky ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{signal.label}</p>
                  <p className="text-xs text-subtle">{signal.detail}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color }}>
                  {signal.points > 0 ? '+' : ''}
                  {signal.points}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Potential linked accounts ───────────────────────────────────────── */}
      <section className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <h2 className="mb-1 font-semibold text-foreground">Potential linked accounts</h2>
        <p className="mb-4 text-sm" style={{ color: 'var(--text-3)' }}>
          Accounts that share signals with this one. Discord exposes no IP or device data, so these are
          possibilities to check — never confirmed alts.
        </p>

        {linked.length === 0 ? (
          <EmptyState
            icon={<Link2 size={20} />}
            title="No potential links found"
            description="Nothing in this server correlates strongly enough with this account to suggest a link."
            variant="muted"
          />
        ) : (
          <div className="space-y-3">
            {linked.map((candidate) => {
              const isLinked = candidate.manual || linkedIds.has(candidate.userId)
              const existing = links.find(
                (l) => l.user_id === candidate.userId || l.linked_user_id === candidate.userId,
              )
              return (
                <div
                  key={candidate.userId}
                  className="rounded-lg border p-3"
                  style={{ borderColor: 'var(--line)', background: 'var(--bg-2)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <AccountChip
                        avatar={candidate.avatar}
                        name={candidate.displayName ?? candidate.username}
                        subtitle={`@${candidate.username}`}
                        size={32}
                      />
                      <RiskBadge level={candidate.risk.level} score={candidate.risk.score} size="sm" />
                    </div>
                    <div className="flex items-center gap-3">
                      <ConfidenceMeter confidence={candidate.confidence} manual={candidate.manual} />
                      {isLinked && existing ? (
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => setUnlinking(existing)}
                          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                        >
                          <Link2Off size={12} /> Unlink
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => void handleLink(candidate)}
                          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                          title="Mark these accounts as related"
                        >
                          <Link2 size={12} /> Link
                        </button>
                      )}
                    </div>
                  </div>
                  <ul className="mt-3 space-y-1 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
                    {candidate.indicators.map((indicator) => (
                      <li key={indicator.id} className="flex items-start gap-2 text-xs">
                        <Sparkles size={11} className="mt-0.5 shrink-0" style={{ color: 'var(--p-1)' }} />
                        <span className="text-foreground">{indicator.label}</span>
                        <span className="min-w-0 flex-1 truncate text-subtle">— {indicator.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Investigation ───────────────────────────────────────────────────── */}
      <section className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-foreground">Investigation</h2>
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>
              {investigation
                ? `Opened ${new Date(investigation.created_at).toLocaleDateString()}${
                    investigation.opened_by_name ? ` by ${investigation.opened_by_name}` : ''
                  }.`
                : 'No case open for this account yet.'}
            </p>
          </div>
          {!investigation && (
            <button
              type="button"
              disabled={working}
              onClick={() => void handleOpenCase()}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
              style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
            >
              <AlertTriangle size={12} /> Open investigation
            </button>
          )}
        </div>

        {investigation && (
          <div className="mb-5 flex flex-wrap gap-1.5">
            {INVESTIGATION_STATUSES.map((s) => {
              const active = investigation.status === s
              const meta = STATUS_META[s]
              return (
                <button
                  key={s}
                  type="button"
                  disabled={working || active}
                  onClick={() => void handleStatus(s)}
                  title={meta.description}
                  className="rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-default"
                  style={
                    active
                      ? { background: `${meta.color}1f`, borderColor: meta.color, color: meta.color }
                      : { borderColor: 'var(--line-strong)', color: 'var(--text-2)' }
                  }
                >
                  {meta.label}
                </button>
              )
            })}
          </div>
        )}

        {investigation?.resolution && (
          <div
            className="mb-5 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line)' }}
          >
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: '#34d399' }} />
            <span style={{ color: 'var(--text-2)' }}>{investigation.resolution}</span>
          </div>
        )}

        {/* Note composer */}
        <div className="mb-5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Add an investigation note — what you checked, what you found, what you decided."
            className="w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--p-1)]"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={working || !note.trim()}
              onClick={() => void handleNote()}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
            >
              <MessageSquare size={12} /> Save note
            </button>
          </div>
        </div>

        {/* Timeline */}
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
          Timeline
        </p>
        {timeline.length === 0 ? (
          <p className="text-sm text-subtle">
            Nothing recorded yet. Notes, status changes and links all land here.
          </p>
        ) : (
          <ol className="relative space-y-4 pl-5">
            <span
              className="absolute bottom-2 left-[5px] top-2 w-px"
              style={{ background: 'var(--line-strong)' }}
              aria-hidden
            />
            {timeline.map((event) => (
              <li key={event.id} className="relative">
                <span
                  className="absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full border-2"
                  style={{
                    background: 'var(--panel)',
                    borderColor: event.kind === 'note' ? 'var(--p-1)' : 'var(--line-strong)',
                  }}
                  aria-hidden
                />
                <p className="text-sm text-foreground">{event.body ?? event.kind}</p>
                <p className="mt-0.5 text-xs text-subtle">
                  {event.author_name ?? 'Pulse'} · <TimeAgo iso={event.created_at} />
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {closing && (
        <ConfirmDialog
          title={`Close as "${STATUS_META[closing].label}"?`}
          description={STATUS_META[closing].description}
          confirmLabel={`Mark ${STATUS_META[closing].label.toLowerCase()}`}
          tone={closing === 'cleared' ? 'default' : 'destructive'}
          busy={working}
          error={error}
          fields={[
            {
              key: 'resolution',
              kind: 'textarea',
              label: 'Outcome (optional)',
              placeholder: 'What did you conclude?',
              maxLength: 500,
            },
          ]}
          onConfirm={(values) => void handleConfirmClose(values.resolution ?? '')}
          onCancel={() => setClosing(null)}
        />
      )}

      {unlinking && (
        <ConfirmDialog
          title="Remove this link?"
          description="The accounts stay in the system — only the moderator-asserted link between them is removed. Pulse may still surface them as a potential match."
          confirmLabel="Remove link"
          tone="destructive"
          busy={working}
          error={error}
          onConfirm={() => void handleUnlink()}
          onCancel={() => setUnlinking(null)}
        />
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm text-foreground">{children}</dd>
    </div>
  )
}
