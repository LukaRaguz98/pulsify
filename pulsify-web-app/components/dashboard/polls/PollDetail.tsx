'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  X, BarChart3, Users, Clock, Hash, Pencil, Lock, Archive, Trash2, Download, Shield, Landmark, Trophy, EyeOff,
} from 'lucide-react'
import { createClient as createSupabase } from '@/lib/supabase'
import {
  STATUS_META,
  POLL_TYPE_META,
  describeRequirements,
  hasRequirements,
  hasGovernance,
  computeResults,
  timeAgo,
  type Poll,
  type PollResults,
} from '@/lib/polls'
import { getPollVotes, closePollNow, archivePoll, deletePoll, type ActionResult, type VoteBreakdownRow } from '@/app/dashboard/[guildId]/polls/actions'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PollIcon } from './icons'
import { Countdown } from './Countdown'

type Props = {
  guildId: string
  poll: Poll
  roleNames?: Map<string, string>
  channelName?: string
  readOnly?: boolean
  onEdit: () => void
  onClose: () => void
  runAction: <T>(fn: () => Promise<ActionResult<T>>, successMsg?: string) => Promise<ActionResult<T>>
}

type ConfirmKind = 'close' | 'archive' | 'delete' | null

export function PollDetail({ guildId, poll, roleNames, channelName, readOnly, onEdit, onClose, runAction }: Props) {
  const meta = STATUS_META[poll.status]
  const typeMeta = POLL_TYPE_META[poll.poll_type]
  const [votes, setVotes] = useState<VoteBreakdownRow[] | null>(null)
  const [anonymous, setAnonymous] = useState(poll.anonymous)
  const [confirm, setConfirm] = useState<ConfirmKind>(null)
  const [busy, setBusy] = useState(false)

  const supabase = useMemo(() => createSupabase(), [])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchVotes = useCallback(async () => {
    const res = await getPollVotes(guildId, poll.id)
    if (res.ok) {
      setVotes(res.data.votes)
      setAnonymous(res.data.anonymous)
    }
  }, [guildId, poll.id])

  useEffect(() => {
    let active = true
    getPollVotes(guildId, poll.id).then((res) => {
      if (active && res.ok) {
        setVotes(res.data.votes)
        setAnonymous(res.data.anonymous)
      }
    })
    return () => {
      active = false
    }
  }, [guildId, poll.id])

  // Live results: re-pull votes as members vote (only while the poll is open).
  useEffect(() => {
    if (poll.status !== 'active') return
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void fetchVotes(), 600)
    }
    const channel = supabase
      .channel(`poll-votes:${poll.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes', filter: `poll_id=eq.${poll.id}` }, schedule)
      .subscribe()
    return () => {
      if (timer.current) clearTimeout(timer.current)
      void supabase.removeChannel(channel)
    }
  }, [supabase, poll.id, poll.status, fetchVotes])

  useEffect(() => {
    document.body.classList.add('slide-over-open')
    return () => document.body.classList.remove('slide-over-open')
  }, [])

  // Prefer the stored snapshot for a settled poll; otherwise compute live.
  const results: PollResults = useMemo(() => {
    if ((poll.status === 'closed' || poll.status === 'archived') && poll.results) return poll.results
    const rows = (votes ?? []).map((v) => ({ user_id: v.user_id ?? `anon-${v.voted_at}`, option_id: v.option_id, weight: v.weight }))
    return computeResults(poll.options, poll.governance, rows)
  }, [poll, votes])

  const winnerSet = new Set(results.winner_ids)
  const labelFor = useMemo(() => new Map(poll.options.map((o) => [o.id, o.label])), [poll.options])

  function exportCsv() {
    const rows = [['user_id', 'user_name', 'option', 'weight', 'voted_at']]
    for (const v of votes ?? []) {
      rows.push([
        v.user_id ?? 'anonymous',
        (v.user_name ?? '').replace(/"/g, "'"),
        labelFor.get(v.option_id) ?? v.option_id,
        String(v.weight),
        v.voted_at,
      ])
    }
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `poll-${poll.id.slice(0, 8)}-votes.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function run(kind: Exclude<ConfirmKind, null>) {
    setBusy(true)
    const map = {
      close: () => closePollNow(guildId, poll.id),
      archive: () => archivePoll(guildId, poll.id),
      delete: () => deletePoll(guildId, poll.id),
    } as const
    const msg = { close: 'Closing poll…', archive: 'Poll archived.', delete: 'Poll deleted.' }[kind]
    const res = await runAction(map[kind], msg)
    setBusy(false)
    setConfirm(null)
    if (res.ok && (kind === 'delete' || kind === 'archive')) onClose()
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <aside
          role="dialog"
          aria-modal="true"
          className="relative flex w-full max-w-lg max-h-[90vh] flex-col overflow-hidden rounded-2xl border shadow-2xl"
          style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                <PollIcon name={typeMeta.icon} size={20} />
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold text-foreground">{poll.title}</h2>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: meta.color, background: `${meta.color}1f` }}>
                    <PollIcon name={meta.icon} size={11} />
                    {meta.label}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{typeMeta.label}</span>
                  {anonymous && (
                    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
                      <EyeOff size={11} /> Anonymous
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5" style={{ color: 'var(--text-3)' }}>
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {poll.description && (
              <p className="whitespace-pre-wrap rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
                {poll.description}
              </p>
            )}

            {/* Facts */}
            <div className="grid grid-cols-2 gap-2.5">
              <Fact icon={<BarChart3 size={14} />} label="Votes" value={results.total_votes.toLocaleString()} />
              <Fact icon={<Users size={14} />} label="Voters" value={results.total_voters.toLocaleString()} />
              <Fact
                icon={<Clock size={14} />}
                label={poll.status === 'active' ? 'Closes' : poll.status === 'scheduled' ? 'Opens' : 'Closed'}
                value={
                  poll.status === 'active' && poll.ends_at ? (
                    <Countdown target={poll.ends_at} endedLabel="now" prefix="in " />
                  ) : poll.status === 'active' ? (
                    'when closed'
                  ) : poll.status === 'scheduled' && poll.starts_at ? (
                    <Countdown target={poll.starts_at} endedLabel="now" prefix="in " />
                  ) : poll.closed_at ? (
                    timeAgo(poll.closed_at)
                  ) : (
                    '—'
                  )
                }
              />
              <Fact icon={<Hash size={14} />} label="Channel" value={`#${channelName ?? poll.channel_id}`} />
            </div>

            {/* Results / live tally */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                <BarChart3 size={13} /> {poll.status === 'active' ? 'Live results' : 'Results'}
              </p>
              <div className="space-y-2.5">
                {results.options.map((o) => (
                  <div key={o.id}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="inline-flex items-center gap-1.5" style={{ color: winnerSet.has(o.id) ? '#a855f7' : 'var(--text-2)' }}>
                        {winnerSet.has(o.id) && results.total_votes > 0 && <Trophy size={12} />}
                        {o.label}
                      </span>
                      <span style={{ color: 'var(--text-3)' }}>{o.pct}% · {o.votes}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${o.pct}%`, background: winnerSet.has(o.id) ? 'linear-gradient(90deg, var(--p-1), var(--p-2))' : 'var(--text-3)' }}
                      />
                    </div>
                  </div>
                ))}
                {results.total_votes === 0 && <p className="text-sm" style={{ color: 'var(--text-3)' }}>No votes yet.</p>}
              </div>
            </div>

            {/* Governance outcome */}
            {hasGovernance(poll.governance) && (
              <div className="rounded-xl border p-3" style={{ borderColor: 'var(--line-strong)' }}>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                  <Landmark size={13} /> Governance
                </p>
                <ul className="space-y-1 text-sm" style={{ color: 'var(--text-3)' }}>
                  {poll.governance.weighted && <li>• Weighted by {poll.governance.weight_basis}</li>}
                  {poll.governance.approval_threshold > 0 && (
                    <li>• Approval threshold {poll.governance.approval_threshold}% — <span style={{ color: results.approved ? '#22c55e' : '#f87171' }}>{results.approved ? 'met' : 'not met'}</span></li>
                  )}
                  {poll.governance.min_participation > 0 && (
                    <li>• Participation {poll.governance.min_participation}+ voters — <span style={{ color: results.participation_met ? '#22c55e' : '#f87171' }}>{results.participation_met ? 'met' : 'not met'}</span></li>
                  )}
                </ul>
              </div>
            )}

            {/* Restrictions */}
            {hasRequirements(poll.requirements) && (
              <div className="rounded-xl border p-3" style={{ borderColor: 'var(--line-strong)' }}>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                  <Shield size={13} /> Who can vote
                </p>
                <ul className="space-y-0.5 text-sm" style={{ color: 'var(--text-3)' }}>
                  {describeRequirements(poll.requirements, (id) => roleNames?.get(id) ?? 'a role').map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Voter breakdown (hidden for anonymous polls) */}
            {!anonymous && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                    <Users size={13} /> Voters {votes ? `(${new Set(votes.map((v) => v.user_id)).size})` : ''}
                  </p>
                  {votes && votes.length > 0 && !readOnly && (
                    <button onClick={exportCsv} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--p-1)' }}>
                      <Download size={12} /> Export CSV
                    </button>
                  )}
                </div>
                {votes === null ? (
                  <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading…</p>
                ) : votes.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-3)' }}>No votes yet.</p>
                ) : (
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border p-2" style={{ borderColor: 'var(--line-strong)' }}>
                    {votes.map((v, i) => (
                      <div key={`${v.user_id}-${v.option_id}-${i}`} className="flex items-center gap-2 px-1.5 py-1 text-sm" style={{ color: 'var(--text-2)' }}>
                        <span className="truncate">{v.user_name ?? v.user_id}</span>
                        <span className="ml-auto shrink-0 rounded px-1.5 text-[11px]" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
                          {labelFor.get(v.option_id) ?? v.option_id}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions (admins only) */}
          {!readOnly && (
            <div className="grid grid-cols-2 gap-2 border-t p-4" style={{ borderColor: 'var(--line-strong)' }}>
              {(poll.status === 'scheduled' || poll.status === 'active') && (
                <ActionBtn onClick={onEdit} icon={<Pencil size={14} />} label="Edit" />
              )}
              {poll.status === 'active' && (
                <ActionBtn onClick={() => setConfirm('close')} icon={<Lock size={14} />} label="Close now" accent />
              )}
              {poll.status === 'closed' && (
                <ActionBtn onClick={() => setConfirm('archive')} icon={<Archive size={14} />} label="Archive" />
              )}
              <ActionBtn onClick={() => setConfirm('delete')} icon={<Trash2 size={14} />} label="Delete" danger />
            </div>
          )}
        </aside>
      </div>

      {confirm === 'close' && (
        <ConfirmDialog
          title="Close poll now?"
          description="This closes voting immediately and tallies the final result. This can't be undone."
          confirmLabel="Close poll"
          busy={busy}
          onConfirm={() => run('close')}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'archive' && (
        <ConfirmDialog
          title="Archive poll?"
          description="The poll moves to your archive and its Discord message is marked archived. Results are kept."
          confirmLabel="Archive"
          tone="warning"
          busy={busy}
          onConfirm={() => run('archive')}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title="Delete poll?"
          description="Permanently removes this poll, all its votes, and its Discord message."
          confirmLabel="Delete"
          tone="destructive"
          busy={busy}
          onConfirm={() => run('delete')}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  )
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-2.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
        {icon}
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

function ActionBtn({ onClick, icon, label, accent, danger }: { onClick: () => void; icon: React.ReactNode; label: string; accent?: boolean; danger?: boolean }) {
  const style = accent
    ? { background: 'linear-gradient(135deg, var(--p-1), var(--p-2))', color: '#fff', border: 'none' }
    : danger
      ? { borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }
      : { borderColor: 'var(--line-strong)', color: 'var(--text-2)' }
  return (
    <button onClick={onClick} className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors" style={style}>
      {icon}
      {label}
    </button>
  )
}
