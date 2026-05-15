'use client'

import { useState, useMemo } from 'react'
import Image from 'next/image'
import { Shield, ShieldOff, Loader2, AlertCircle, Search } from 'lucide-react'
import { avatarUrl, type EnrichedBan } from '@/lib/discord'
import { unbanMember, type ActionTarget } from '@/app/dashboard/[guildId]/moderation/actions'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { SortableHeader, nextSort, type SortDirection } from '@/components/ui/sortable-header'

type Props = {
  guildId: string
  bans: EnrichedBan[]
  onActionComplete: () => void
}

export function BansTab({ guildId, bans, onActionComplete }: Props) {
  const [target, setTarget] = useState<EnrichedBan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [sort, setSort] = useState<{ key: string; dir: SortDirection }>({ key: 'banned_at', dir: 'desc' })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = q
      ? bans.filter(
          (b) =>
            b.user.username.toLowerCase().includes(q) ||
            (b.user.global_name ?? '').toLowerCase().includes(q) ||
            b.user.id.includes(q) ||
            (b.reason ?? '').toLowerCase().includes(q) ||
            (b.moderator?.username ?? '').toLowerCase().includes(q),
        )
      : [...bans]

    const dirMul = sort.dir === 'asc' ? 1 : -1
    matches.sort((a, b) => {
      let cmp = 0
      switch (sort.key) {
        case 'user': {
          const aName = a.user.global_name ?? a.user.username
          const bName = b.user.global_name ?? b.user.username
          cmp = aName.localeCompare(bName)
          break
        }
        case 'reason':
          cmp = (a.reason ?? '').localeCompare(b.reason ?? '')
          break
        case 'moderator':
          cmp = (a.moderator?.username ?? '').localeCompare(b.moderator?.username ?? '')
          break
        case 'banned_at': {
          const aT = a.banned_at ? new Date(a.banned_at).getTime() : 0
          const bT = b.banned_at ? new Date(b.banned_at).getTime() : 0
          cmp = aT - bT
          break
        }
      }
      return cmp * dirMul
    })
    return matches
  }, [bans, search, sort])

  const paged = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const safePage = Math.min(Math.max(1, page), totalPages)
    const start = (safePage - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  function handleSort(key: string) {
    setSort((prev) => nextSort(prev, key, 'desc'))
    setPage(1)
  }

  async function confirmUnban(values: Record<string, string>) {
    if (!target) return
    setBusy(true)
    setError(null)
    const reason = values.reason?.trim() || undefined
    setPendingIds((prev) => new Set(prev).add(target.user.id))
    const actionTarget: ActionTarget = {
      id: target.user.id,
      displayName: target.user.global_name,
      username: target.user.username,
    }
    const result = await unbanMember(guildId, actionTarget, reason)
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

  if (bans.length === 0) {
    return (
      <EmptyState
        icon={<Shield size={36} />}
        title="No active bans"
        description="This server has no banned users."
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
          placeholder="Search banned users..."
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
          icon={<Search size={36} />}
          title="No bans match"
          description={`No bans matching "${search}".`}
        />
      ) : (
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <th className="text-left">
                <SortableHeader label="User" columnKey="user" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
              </th>
              <th className="text-left">
                <SortableHeader label="Reason" columnKey="reason" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
              </th>
              <th className="text-left">
                <SortableHeader label="Moderator" columnKey="moderator" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
              </th>
              <th className="text-left">
                <SortableHeader label="When" columnKey="banned_at" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-subtle">Action</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((ban) => {
              const av = avatarUrl(ban.user.id, ban.user.avatar, ban.user.discriminator)
              const isPending = pendingIds.has(ban.user.id)
              const err = rowErrors[ban.user.id]
              const display = ban.user.global_name
              const hasDisplay = !!display && display !== ban.user.username
              const topLine = hasDisplay ? display! : ban.user.username
              const bottomLine = hasDisplay ? ban.user.username : ban.user.id
              const bottomIsId = !hasDisplay
              return (
                <tr
                  key={ban.user.id}
                  className="border-b"
                  style={{
                    borderColor: 'var(--line-strong)',
                    background: 'color-mix(in srgb, var(--panel) 50%, transparent)',
                  }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {av ? (
                        <Image
                          src={av}
                          alt={topLine}
                          width={28}
                          height={28}
                          className="rounded-full shrink-0"
                          unoptimized
                        />
                      ) : (
                        <div className="h-7 w-7 rounded-full shrink-0" style={{ background: 'var(--bg-2)' }} />
                      )}
                      <div>
                        <p className="text-foreground">{topLine}</p>
                        <p className={`text-xs text-subtle ${bottomIsId ? 'font-mono' : ''}`}>{bottomLine}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {ban.reason ?? 'No reason provided'}
                  </td>
                  <td className="px-4 py-3">
                    {ban.moderator ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-subtle">{ban.moderator.username}</span>
                        {ban.source === 'pulsify' && (
                          <span
                            className="rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
                            title="Banned via the Pulsify dashboard"
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
                  <td className="px-4 py-3 text-subtle text-xs font-mono">
                    {ban.banned_at ? new Date(ban.banned_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {err && (
                        <span className="flex items-center gap-1 text-xs" style={{ color: '#f87171' }}>
                          <AlertCircle size={10} />
                          {err}
                        </span>
                      )}
                      <button
                        onClick={() => setTarget(ban)}
                        disabled={isPending}
                        title={`Unban ${ban.user.username}`}
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
                        {isPending ? <Loader2 size={12} className="animate-spin" /> : <ShieldOff size={12} />}
                        {isPending ? 'Unbanning…' : 'Unban'}
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
          title={`Unban ${target.user.username}?`}
          description="They will be able to rejoin the server with an invite."
          tone="default"
          confirmLabel="Unban"
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
          onConfirm={confirmUnban}
        />
      )}
    </div>
  )
}
