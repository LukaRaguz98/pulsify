'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
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
import { STATUS_COLOR, inviteAvatarUrl, type AvatarMap } from './icons'
import { setInviteValidity } from '@/app/dashboard/[guildId]/(management)/invites/actions'
import type { Feedback } from './InvitesContent'

type Props = {
  guildId: string
  members: InvitedMember[]
  avatars: AvatarMap
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

/** Same date rendering as the Members directory's "Joined" column. */
function joinedDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function InviteMembers({ guildId, members, avatars, setFeedback, onDone }: Props) {
  const router = useRouter()
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
      {/* Toolbar mirrors the Members directory: same search field and filter pills. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full sm:w-[360px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by member, inviter or code…"
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-lg border p-1" style={{ borderColor: 'var(--line-strong)' }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => { setFilter(f.key); setPage(1) }}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition"
              style={{
                background: filter === f.key ? 'var(--p-soft)' : 'transparent',
                color: filter === f.key ? 'var(--p-1)' : 'var(--text-3)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<Users2 size={22} />} title="No invited members" description="Nobody matches this filter yet." variant="muted" />
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--line-strong)' }}>
          <table className="w-full min-w-[860px] text-sm table-stack">
            <thead>
              <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Member</th>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Inviter</th>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Joined</th>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Account age</th>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-3)' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((m) => {
                const canApprove = m.status === 'fake' || m.status === 'invalid'
                // Only members who are still here have a server profile to open —
                // departed joins stay as plain rows so we never link into nothing.
                const interactive = m.status !== 'left' && !m.left_at
                return (
                  <tr
                    key={m.id}
                    onClick={interactive ? () => router.push(`/dashboard/${guildId}/members/${m.user_id}`) : undefined}
                    className={`border-b transition-colors${interactive ? ' cursor-pointer' : ''}`}
                    style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}
                    onMouseEnter={interactive ? (e) => { e.currentTarget.style.background = 'var(--bg-2)' } : undefined}
                    onMouseLeave={interactive ? (e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--panel) 50%, transparent)' } : undefined}
                  >
                    <td className="px-4 py-3" data-label="">
                      <div className="flex items-center gap-3">
                        <Image src={inviteAvatarUrl(m.user_id, avatars)} alt={m.user_name ?? m.user_id} width={30} height={30} unoptimized className="rounded-full shrink-0" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{m.user_name ?? `User ${m.user_id.slice(0, 8)}`}</p>
                          <p className="mt-0.5 truncate text-xs text-subtle">
                            {SOURCE_META[m.source]}{m.rejoin_count > 0 ? ` · ${m.rejoin_count} rejoin${m.rejoin_count === 1 ? '' : 's'}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground" data-label="Inviter">
                      {m.inviter_id ? (m.inviter_name ?? `User ${m.inviter_id.slice(0, 8)}`) : <span className="text-subtle">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-subtle" data-label="Joined">{joinedDate(m.joined_at)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground" data-label="Account age">
                      {m.account_created_at ? `${accountAgeDays(m.account_created_at).toLocaleString()}d` : '—'}
                    </td>
                    <td className="px-4 py-3" data-label="Status">
                      <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${STATUS_COLOR[m.status]}1f`, color: STATUS_COLOR[m.status] }} title={m.fake_reason ? reasonLabel(m.fake_reason) ?? undefined : STATUS_META[m.status].hint}>
                        {statusLabel(m.status)}
                      </span>
                      {m.fake_reason && <div className="mt-0.5 text-[11px] text-subtle">{reasonLabel(m.fake_reason)}</div>}
                    </td>
                    <td className="px-4 py-3" data-label="">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setConfirm({ member: m, approve: canApprove }) }}
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
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }} />
        </div>
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
