'use client'

import { useMemo, useState, useTransition } from 'react'
import { Search, Users2, Check, Ban } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  statusLabel,
  reasonLabel,
  SOURCE_META,
  accountAgeDays,
  STATUS_META,
  type InvitedMember,
  type InviteStatus,
} from '@/lib/invites'
import { STATUS_COLOR } from './icons'
import { setInviteValidity } from '@/app/dashboard/[guildId]/(management)/invites/actions'
import type { Feedback } from './InvitesContent'

type Props = {
  guildId: string
  members: InvitedMember[]
  setFeedback: (f: Feedback) => void
  onDone: () => void
}

const FILTERS: { key: 'all' | InviteStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'valid', label: 'Valid' },
  { key: 'pending', label: 'Pending' },
  { key: 'invalid', label: 'Invalid' },
  { key: 'fake', label: 'Fake' },
  { key: 'left', label: 'Left' },
]

export function InviteMembers({ guildId, members, setFeedback, onDone }: Props) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | InviteStatus>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [confirm, setConfirm] = useState<{ member: InvitedMember; approve: boolean } | null>(null)
  const [busy, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members.filter((m) => {
      if (m.is_bonus) return false
      if (filter !== 'all' && m.status !== filter) return false
      if (!q) return true
      return (
        (m.user_name ?? '').toLowerCase().includes(q) ||
        (m.inviter_name ?? '').toLowerCase().includes(q) ||
        (m.invite_code ?? '').toLowerCase().includes(q)
      )
    })
  }, [members, search, filter])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  function submit() {
    if (!confirm) return
    const { member, approve } = confirm
    startTransition(async () => {
      const res = await setInviteValidity(guildId, member.user_id, approve, null)
      if (res.ok) {
        setFeedback({ kind: 'success', msg: approve ? 'Invite approved.' : 'Invite invalidated.' })
        onDone()
      } else {
        setFeedback({ kind: 'error', msg: res.error })
      }
      setConfirm(null)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search member, inviter or code"
            className="w-full rounded-xl border py-2 pl-9 pr-3 text-sm outline-none"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text)' }}
          />
        </div>
        <div className="inline-flex flex-wrap rounded-xl border p-1" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
          {FILTERS.map((f) => {
            const active = filter === f.key
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => { setFilter(f.key); setPage(1) }}
                className="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
                style={active ? { background: 'var(--p-soft)', color: 'var(--p-1)' } : { color: 'var(--text-2)' }}
              >
                {f.label}
              </button>
            )
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<Users2 size={22} />} title="No invited members" description="Nobody matches this filter yet." variant="muted" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--line)' }}>
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-subtle" style={{ borderColor: 'var(--line)' }}>
                  <th className="px-4 py-3 font-semibold">Member</th>
                  <th className="px-4 py-3 font-semibold">Inviter</th>
                  <th className="px-4 py-3 font-semibold">Joined</th>
                  <th className="px-4 py-3 font-semibold">Account age</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((m) => {
                  const canApprove = m.status === 'fake' || m.status === 'invalid'
                  return (
                    <tr key={m.id} className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
                      <td className="px-4 py-3">
                        <div className="truncate font-medium text-foreground">{m.user_name ?? `User ${m.user_id.slice(0, 8)}`}</div>
                        <div className="text-[11px] text-subtle">{SOURCE_META[m.source]}{m.rejoin_count > 0 ? ` · ${m.rejoin_count} rejoin${m.rejoin_count === 1 ? '' : 's'}` : ''}</div>
                      </td>
                      <td className="px-4 py-3 text-foreground">{m.inviter_id ? (m.inviter_name ?? `User ${m.inviter_id.slice(0, 8)}`) : <span className="text-subtle">—</span>}</td>
                      <td className="px-4 py-3 text-subtle">{m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3 text-subtle">{m.account_created_at ? `${accountAgeDays(m.account_created_at)}d` : '—'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${STATUS_COLOR[m.status]}1f`, color: STATUS_COLOR[m.status] }} title={m.fake_reason ? reasonLabel(m.fake_reason) ?? undefined : STATUS_META[m.status].hint}>
                          {statusLabel(m.status)}
                        </span>
                        {m.fake_reason && <div className="mt-0.5 text-[11px] text-subtle">{reasonLabel(m.fake_reason)}</div>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setConfirm({ member: m, approve: canApprove })}
                          className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--bg-2)]"
                          style={{ borderColor: 'var(--line-strong)', color: canApprove ? '#22c55e' : '#f87171' }}
                        >
                          {canApprove ? <><Check size={13} /> Approve</> : <><Ban size={13} /> Invalidate</>}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }} />
        </>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.approve ? 'Approve this invite?' : 'Invalidate this invite?'}
          description={
            confirm.approve
              ? `${confirm.member.user_name ?? 'This member'} will count as a valid invite for their inviter.`
              : `${confirm.member.user_name ?? 'This member'} will no longer count toward their inviter's score.`
          }
          confirmLabel={confirm.approve ? 'Approve' : 'Invalidate'}
          tone={confirm.approve ? 'default' : 'warning'}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={submit}
        />
      )}
    </div>
  )
}
