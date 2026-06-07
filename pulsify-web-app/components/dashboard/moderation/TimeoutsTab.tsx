'use client'

import { useState, useMemo } from 'react'
import Image from 'next/image'
import { Clock, ClockArrowUp, Loader2, AlertCircle, Search } from 'lucide-react'
import { avatarUrl, type DiscordMember } from '@/lib/discord'
import {
  removeMemberTimeout,
  type ActionTarget,
} from '@/app/dashboard/[guildId]/moderation/actions'
import type { TimeoutMeta } from '@/app/api/discord/guild/[guildId]/moderation/timeout-meta/route'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { SortableHeader, nextSort, type SortDirection } from '@/components/ui/sortable-header'

type Props = {
  guildId: string
  members: DiscordMember[]
  meta: TimeoutMeta[]
  /** Reference time used to evaluate whether a timeout is still active. */
  referenceTime: number
  onActionComplete: () => void
}

function memberDisplayName(m: DiscordMember): string {
  return m.nick ?? m.user.global_name ?? m.user.username
}

function memberLines(m: DiscordMember): { top: string; bottom: string; bottomIsId: boolean } {
  const display = m.nick ?? m.user.global_name
  if (display && display !== m.user.username) {
    return { top: display, bottom: m.user.username, bottomIsId: false }
  }
  return { top: m.user.username, bottom: m.user.id, bottomIsId: true }
}

function timeUntil(iso: string, referenceTime: number): string {
  const ms = new Date(iso).getTime() - referenceTime
  if (ms <= 0) return 'expired'
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const totalMin = Math.round(totalSec / 60)
  if (totalMin < 60) return `${totalMin}m`
  const totalHr = Math.round(totalMin / 60)
  if (totalHr < 24) return `${totalHr}h`
  const days = Math.round(totalHr / 24)
  return `${days}d`
}

export function TimeoutsTab({ guildId, members, meta, referenceTime, onActionComplete }: Props) {
  const [target, setTarget] = useState<DiscordMember | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [sort, setSort] = useState<{ key: string; dir: SortDirection }>({ key: 'until', dir: 'asc' })

  const metaByUserId = useMemo(() => {
    const map = new Map<string, TimeoutMeta>()
    for (const m of meta) map.set(m.user_id, m)
    return map
  }, [meta])

  const timedOut = useMemo(
    () =>
      members.filter(
        (m) =>
          m.communication_disabled_until &&
          new Date(m.communication_disabled_until).getTime() > referenceTime,
      ),
    [members, referenceTime],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = q
      ? timedOut.filter((m) => {
          const info = metaByUserId.get(m.user.id)
          const name = memberDisplayName(m).toLowerCase()
          return (
            name.includes(q) ||
            m.user.username.toLowerCase().includes(q) ||
            m.user.id.includes(q) ||
            (info?.reason ?? '').toLowerCase().includes(q) ||
            (info?.moderator?.username ?? '').toLowerCase().includes(q)
          )
        })
      : [...timedOut]

    const dirMul = sort.dir === 'asc' ? 1 : -1
    matches.sort((a, b) => {
      let cmp = 0
      const ma = metaByUserId.get(a.user.id)
      const mb = metaByUserId.get(b.user.id)
      switch (sort.key) {
        case 'user':
          cmp = memberDisplayName(a).localeCompare(memberDisplayName(b))
          break
        case 'reason':
          cmp = (ma?.reason ?? '').localeCompare(mb?.reason ?? '')
          break
        case 'moderator':
          cmp = (ma?.moderator?.username ?? '').localeCompare(mb?.moderator?.username ?? '')
          break
        case 'issued_at': {
          const aT = ma?.issued_at ? new Date(ma.issued_at).getTime() : 0
          const bT = mb?.issued_at ? new Date(mb.issued_at).getTime() : 0
          cmp = aT - bT
          break
        }
        case 'until': {
          const aT = a.communication_disabled_until ? new Date(a.communication_disabled_until).getTime() : 0
          const bT = b.communication_disabled_until ? new Date(b.communication_disabled_until).getTime() : 0
          cmp = aT - bT
          break
        }
      }
      return cmp * dirMul
    })
    return matches
  }, [timedOut, search, sort, metaByUserId])

  const paged = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const safePage = Math.min(Math.max(1, page), totalPages)
    const start = (safePage - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  function handleSort(key: string) {
    setSort((prev) => nextSort(prev, key, key === 'until' ? 'asc' : 'desc'))
    setPage(1)
  }

  async function confirmRemoveTimeout(values: Record<string, string>) {
    if (!target) return
    setBusy(true)
    setError(null)
    const reason = values.reason?.trim() || undefined
    setPendingIds((prev) => new Set(prev).add(target.user.id))
    const actionTarget: ActionTarget = {
      id: target.user.id,
      displayName: target.nick ?? target.user.global_name,
      username: target.user.username,
    }
    const result = await removeMemberTimeout(guildId, actionTarget, reason)
    setBusy(false)
    setPendingIds((prev) => {
      const n = new Set(prev)
      n.delete(target.user.id)
      return n
    })
    if (!result.ok) {
      setError(result.error)
      setRowErrors((prev) => ({ ...prev, [target.user.id]: result.error }))
      setTimeout(() => {
        setRowErrors((prev) => {
          const n = { ...prev }
          delete n[target.user.id]
          return n
        })
      }, 5000)
      return
    }
    setTarget(null)
    onActionComplete()
  }

  if (timedOut.length === 0) {
    return (
      <EmptyState
        icon={<Clock size={24} />}
        title="No active timeouts"
        description="No members are currently muted via Discord timeout."
      />
    )
  }

  return (
    <div>
      <div className="mb-4 relative max-w-md">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search timed-out members…"
          className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
          style={{
            background: 'var(--bg-2)',
            borderColor: 'var(--line-strong)',
            color: 'var(--text)',
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          variant="muted"
          icon={<Search size={24} />}
          title="No matches"
          description={`No timed-out members matching "${search}".`}
        />
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--line-strong)' }}>
          <table className="w-full min-w-[760px] text-sm table-stack">
            <thead>
              <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                <th className="text-left">
                  <SortableHeader label="Member" columnKey="user" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
                <th className="text-left">
                  <SortableHeader label="Reason" columnKey="reason" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
                <th className="text-left">
                  <SortableHeader label="Moderator" columnKey="moderator" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
                <th className="text-left">
                  <SortableHeader label="When" columnKey="issued_at" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
                <th className="text-left">
                  <SortableHeader label="Ends" columnKey="until" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-subtle">Action</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((m) => {
                const av = avatarUrl(m.user.id, m.user.avatar)
                const lines = memberLines(m)
                const isPending = pendingIds.has(m.user.id)
                const err = rowErrors[m.user.id]
                const until = m.communication_disabled_until!
                const info = metaByUserId.get(m.user.id) ?? null
                return (
                  <tr
                    key={m.user.id}
                    className="border-b"
                    style={{
                      borderColor: 'var(--line-strong)',
                      background: 'color-mix(in srgb, var(--panel) 50%, transparent)',
                    }}
                  >
                    <td className="px-4 py-3" data-label="">
                      <div className="flex items-center gap-3">
                        <Image src={av} alt={lines.top} width={28} height={28} className="rounded-full shrink-0" unoptimized />
                        <div className="min-w-0">
                          <p className="truncate text-foreground">{lines.top}</p>
                          <p className={`truncate text-xs text-subtle ${lines.bottomIsId ? 'font-mono' : ''}`}>
                            {lines.bottom}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-xs truncate" title={info?.reason ?? undefined} data-label="Reason">
                      {info?.reason ?? '—'}
                    </td>
                    <td className="px-4 py-3" data-label="Moderator">
                      {info?.moderator ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-subtle">{info.moderator.username}</span>
                          {info.source === 'pulsify' && (
                            <span
                              className="rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                              style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
                              title="Issued via the Pulsify dashboard"
                            >
                              Pulsify
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-subtle" title="Older than 45 days or audit log unavailable">
                          Unknown
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-subtle text-xs font-mono" data-label="When">
                      {info?.issued_at ? new Date(info.issued_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3" data-label="Ends">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
                          style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}
                          title={new Date(until).toLocaleString()}
                        >
                          <Clock size={10} />
                          {timeUntil(until, referenceTime)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center" data-label="">
                      <div className="flex items-center justify-center gap-2">
                        {err && (
                          <span className="flex items-center gap-1 text-xs" style={{ color: '#f87171' }}>
                            <AlertCircle size={10} />
                            {err}
                          </span>
                        )}
                        <button
                          onClick={() => setTarget(m)}
                          disabled={isPending}
                          title={`Remove timeout from ${lines.top}`}
                          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all disabled:opacity-50"
                          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
                          onMouseEnter={(e) => {
                            if (!isPending) {
                              e.currentTarget.style.background = 'rgba(74,222,128,0.08)'
                              e.currentTarget.style.borderColor = 'rgba(74,222,128,0.35)'
                              e.currentTarget.style.color = '#4ade80'
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = ''
                            e.currentTarget.style.borderColor = 'var(--line-strong)'
                            e.currentTarget.style.color = 'var(--text-3)'
                          }}
                        >
                          {isPending ? <Loader2 size={12} className="animate-spin" /> : <ClockArrowUp size={12} />}
                          {isPending ? 'Removing…' : 'Remove timeout'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
          />
        </div>
      )}

      {target && (
        <ConfirmDialog
          title={`Remove timeout from ${memberDisplayName(target)}?`}
          description="They will be able to participate again immediately."
          tone="default"
          confirmLabel="Remove timeout"
          fields={[
            {
              key: 'reason',
              kind: 'text',
              label: 'Reason (optional)',
              placeholder: 'Reason shown in the audit log',
              maxLength: 500,
            },
          ]}
          busy={busy}
          error={error}
          onCancel={() => {
            if (busy) return
            setTarget(null)
            setError(null)
          }}
          onConfirm={confirmRemoveTimeout}
        />
      )}
    </div>
  )
}
