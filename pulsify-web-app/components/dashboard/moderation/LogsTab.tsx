'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Image from 'next/image'
import { Loader2, Filter } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { ScrollText } from 'lucide-react'
import { Pagination } from '@/components/ui/pagination'
import { SortableHeader, nextSort, type SortDirection } from '@/components/ui/sortable-header'
import { avatarUrl, type DiscordMember } from '@/lib/discord'

type ModerationLog = {
  id: string
  guild_id: string
  action: string
  target_user_id: string | null
  target_username: string | null
  target_display_name: string | null
  moderator_id: string
  moderator_username: string | null
  reason: string | null
  metadata: Record<string, unknown>
  created_at: string
}

/**
 * Returns the two lines to render for the Target column.
 *
 * Newer rows store both display_name and username separately, so we render the
 * familiar "display on top, username below" pattern. Older rows only have
 * target_username (which historically held whatever the caller passed — usually
 * the display name); for those we render that single label with the user ID
 * below as the differentiator.
 */
function targetLines(log: ModerationLog): { top: string; bottom: string | null; bottomIsId: boolean } | null {
  const display = log.target_display_name
  const uname = log.target_username
  const id = log.target_user_id

  if (!display && !uname && !id) return null

  if (display && uname && display !== uname) {
    return { top: display, bottom: uname, bottomIsId: false }
  }
  // No useful display name OR they're the same as the username.
  const top = display ?? uname ?? id!
  return { top, bottom: id && id !== top ? id : null, bottomIsId: true }
}

const ACTION_LABEL: Record<string, string> = {
  timeout: 'Timeout',
  remove_timeout: 'Remove timeout',
  kick: 'Kick',
  ban: 'Ban',
  unban: 'Unban',
  warn: 'Warn',
  nickname: 'Nickname',
  add_role: 'Add role',
  remove_role: 'Remove role',
  delete_message: 'Delete message',
  bulk_delete_messages: 'Bulk delete',
}

const ACTION_COLOR: Record<string, string> = {
  timeout: '#f59e0b',
  remove_timeout: '#4ade80',
  kick: '#fb923c',
  ban: '#ef4444',
  unban: '#4ade80',
  warn: '#f59e0b',
  nickname: '#a78bfa',
  add_role: '#60a5fa',
  remove_role: '#94a3b8',
  delete_message: '#ef4444',
  bulk_delete_messages: '#ef4444',
}

const FILTER_CATEGORIES: { label: string; value: string; actions: string[] }[] = [
  { label: 'All', value: '', actions: [] },
  { label: 'Bans', value: 'bans', actions: ['ban', 'unban'] },
  { label: 'Kicks', value: 'kicks', actions: ['kick'] },
  { label: 'Timeouts', value: 'timeouts', actions: ['timeout', 'remove_timeout'] },
  { label: 'Warnings', value: 'warnings', actions: ['warn'] },
  { label: 'Roles', value: 'roles', actions: ['add_role', 'remove_role'] },
  { label: 'Nicknames', value: 'nicknames', actions: ['nickname'] },
  { label: 'Messages', value: 'messages', actions: ['delete_message', 'bulk_delete_messages'] },
]

type Props = { guildId: string; refreshKey: number; members: DiscordMember[] }

export function LogsTab({ guildId, refreshKey, members }: Props) {
  const memberAvatarById = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const m of members) map.set(m.user.id, m.user.avatar)
    return map
  }, [members])
  const [logs, setLogs] = useState<ModerationLog[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [sort, setSort] = useState<{ key: string; dir: SortDirection }>({ key: 'created_at', dir: 'desc' })

  const load = useCallback(async () => {
    setLoading(true)
    // Fetch a generous unfiltered window — categories filter client-side so a
    // single category can match multiple action types (e.g. Bans = ban+unban).
    const res = await fetch(
      `/api/discord/guild/${guildId}/moderation/logs?limit=200`,
      { cache: 'no-store' },
    )
    if (res.ok) {
      const data: ModerationLog[] = await res.json()
      setLogs(data)
    }
    setLoading(false)
  }, [guildId])

  useEffect(() => { load() }, [load, refreshKey])

  const filtered = useMemo(() => {
    const cat = FILTER_CATEGORIES.find((c) => c.value === category)
    const matches = !cat || cat.actions.length === 0
      ? [...logs]
      : logs.filter((l) => cat.actions.includes(l.action))

    const dirMul = sort.dir === 'asc' ? 1 : -1
    matches.sort((a, b) => {
      let cmp = 0
      switch (sort.key) {
        case 'action':
          cmp = (ACTION_LABEL[a.action] ?? a.action).localeCompare(ACTION_LABEL[b.action] ?? b.action)
          break
        case 'target': {
          const aName = a.target_display_name ?? a.target_username ?? a.target_user_id ?? ''
          const bName = b.target_display_name ?? b.target_username ?? b.target_user_id ?? ''
          cmp = aName.localeCompare(bName)
          break
        }
        case 'reason':
          cmp = (a.reason ?? '').localeCompare(b.reason ?? '')
          break
        case 'moderator':
          cmp = (a.moderator_username ?? a.moderator_id).localeCompare(b.moderator_username ?? b.moderator_id)
          break
        case 'created_at':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          break
      }
      return cmp * dirMul
    })
    return matches
  }, [logs, category, sort])

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

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        <Filter size={14} className="text-muted-foreground shrink-0" />
        {FILTER_CATEGORIES.map((f) => (
          <button
            key={f.value || 'all'}
            onClick={() => { setCategory(f.value); setPage(1) }}
            className="rounded-md px-3 py-1 text-xs font-medium transition whitespace-nowrap"
            style={{
              background: category === f.value ? 'var(--p-soft)' : 'var(--bg-2)',
              color: category === f.value ? 'var(--p-1)' : 'var(--text-3)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ScrollText size={36} />}
          title={logs.length === 0 ? 'No moderation activity yet' : 'No entries match this filter'}
          description={
            logs.length === 0
              ? 'Actions performed from this dashboard will show up here.'
              : 'Try a different category or clear the filter.'
          }
        />
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                <th className="text-left">
                  <SortableHeader label="Action" columnKey="action" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
                <th className="text-left">
                  <SortableHeader label="Target" columnKey="target" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
                <th className="text-left">
                  <SortableHeader label="Reason" columnKey="reason" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
                <th className="text-left">
                  <SortableHeader label="Moderator" columnKey="moderator" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
                <th className="text-left">
                  <SortableHeader label="When" columnKey="created_at" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.map((log) => {
                const color = ACTION_COLOR[log.action] ?? '#94a3b8'
                const label = ACTION_LABEL[log.action] ?? log.action
                return (
                  <tr
                    key={log.id}
                    className="border-b"
                    style={{
                      borderColor: 'var(--line-strong)',
                      background: 'color-mix(in srgb, var(--panel) 50%, transparent)',
                    }}
                  >
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex rounded px-1.5 py-0.5 text-xs font-medium"
                        style={{ background: `${color}1f`, color }}
                      >
                        {label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const lines = targetLines(log)
                        if (!lines) return <span className="text-muted-foreground">—</span>
                        const av = log.target_user_id
                          ? avatarUrl(log.target_user_id, memberAvatarById.get(log.target_user_id) ?? null)
                          : null
                        return (
                          <div className="flex items-center gap-3">
                            {av ? (
                              <Image
                                src={av}
                                alt={lines.top}
                                width={24}
                                height={24}
                                className="rounded-full shrink-0"
                                unoptimized
                              />
                            ) : (
                              <div className="h-6 w-6 rounded-full shrink-0" style={{ background: 'var(--bg-2)' }} />
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-foreground">{lines.top}</p>
                              {lines.bottom && (
                                <p className={`truncate text-xs text-subtle ${lines.bottomIsId ? 'font-mono' : ''}`}>
                                  {lines.bottom}
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-xs truncate" title={log.reason ?? undefined}>
                      {log.reason ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-subtle text-xs">
                      {log.moderator_username ?? log.moderator_id}
                    </td>
                    <td className="px-4 py-3 text-subtle text-xs font-mono">
                      {new Date(log.created_at).toLocaleString()}
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
    </div>
  )
}
