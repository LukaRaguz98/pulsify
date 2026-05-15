'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import {
  Search,
  MoreHorizontal,
  Clock,
  UserMinus,
  Ban,
  AlertCircle,
  Edit3,
  Plus,
  Minus,
  CheckCircle2,
  Crown,
} from 'lucide-react'
import { avatarUrl, type DiscordMember, type DiscordRole, roleColor } from '@/lib/discord'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { SortableHeader, nextSort, type SortDirection } from '@/components/ui/sortable-header'
import {
  timeoutMember,
  removeMemberTimeout,
  kickMember,
  banMember,
  warnMember,
  setMemberNickname,
  addMemberRole,
  removeMemberRole,
  type ActionResult,
  type ActionTarget,
} from '@/app/dashboard/[guildId]/moderation/actions'

type Props = {
  guildId: string
  members: DiscordMember[]
  roles: DiscordRole[]
  onActionComplete: () => void
}

type ActionKind =
  | 'timeout'
  | 'remove_timeout'
  | 'kick'
  | 'ban'
  | 'warn'
  | 'nickname'
  | 'add_role'
  | 'remove_role'

type Pending = {
  kind: ActionKind
  member: DiscordMember
  preselectedRoleId?: string
}

const TIMEOUT_OPTIONS = [
  { label: '60 seconds', value: '1' },
  { label: '5 minutes', value: '5' },
  { label: '10 minutes', value: '10' },
  { label: '1 hour', value: '60' },
  { label: '1 day', value: '1440' },
  { label: '1 week', value: '10080' },
]

const BAN_DELETE_OPTIONS = [
  { label: "Don't delete any", value: '0' },
  { label: 'Last hour', value: '3600' },
  { label: 'Last 6 hours', value: '21600' },
  { label: 'Last 24 hours', value: '86400' },
  { label: 'Last 7 days', value: '604800' },
]

function memberDisplayName(m: DiscordMember): string {
  return m.nick ?? m.user.global_name ?? m.user.username
}

/**
 * Returns the two lines to render for a member row.
 *
 *  - When a server nickname or global display name is set: top = that, bottom = @username.
 *  - When neither is set: top = username, bottom = user ID (so each row still has two
 *    distinguishing pieces of info instead of repeating the username).
 */
function memberLines(m: DiscordMember): {
  top: string
  bottom: string
  bottomIsId: boolean
} {
  const display = m.nick ?? m.user.global_name
  if (display && display !== m.user.username) {
    return { top: display, bottom: m.user.username, bottomIsId: false }
  }
  return { top: m.user.username, bottom: m.user.id, bottomIsId: true }
}

function isInTimeout(m: DiscordMember): boolean {
  if (!m.communication_disabled_until) return false
  return new Date(m.communication_disabled_until).getTime() > Date.now()
}

type OpenMenu = {
  userId: string
  rect: { top: number; left: number; right: number; bottom: number }
}

export function MembersTab({ guildId, members, roles, onActionComplete }: Props) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'no_bots'>('all')
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [sort, setSort] = useState<{ key: string; dir: SortDirection }>({ key: 'role', dir: 'desc' })
  const [roleFilter, setRoleFilter] = useState<string>('')
  const menuRef = useRef<HTMLDivElement | null>(null)

  // close menu on outside click / scroll / resize
  useEffect(() => {
    if (!openMenu) return
    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpenMenu(null)
    }
    function onDismiss() {
      setOpenMenu(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
    }
  }, [openMenu])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const sortedRoles = useMemo(
    () =>
      roles
        .filter((r) => r.name !== '@everyone' && !r.managed)
        .sort((a, b) => b.position - a.position),
    [roles],
  )

  // Highest role position for a member — used for the default sort and the
  // role column. Members with no assignable roles fall to position 0.
  const rolePositionByMember = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of members) {
      let max = 0
      for (const r of sortedRoles) {
        if (m.roles.includes(r.id) && r.position > max) max = r.position
      }
      map.set(m.user.id, max)
    }
    return map
  }, [members, sortedRoles])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = members.filter((m) => {
      if (filter === 'no_bots' && m.user.bot) return false
      if (roleFilter && !m.roles.includes(roleFilter)) return false
      if (!q) return true
      const name = memberDisplayName(m).toLowerCase()
      return (
        name.includes(q) ||
        m.user.username.toLowerCase().includes(q) ||
        m.user.id.includes(q)
      )
    })

    const dirMul = sort.dir === 'asc' ? 1 : -1
    matches.sort((a, b) => {
      let cmp = 0
      switch (sort.key) {
        case 'name':
          cmp = memberDisplayName(a).localeCompare(memberDisplayName(b))
          break
        case 'role':
          cmp = (rolePositionByMember.get(a.user.id) ?? 0) - (rolePositionByMember.get(b.user.id) ?? 0)
          if (cmp === 0) cmp = memberDisplayName(a).localeCompare(memberDisplayName(b))
          break
        case 'joined':
          cmp = new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
          break
        case 'status': {
          const aTo = isInTimeout(a) ? 1 : 0
          const bTo = isInTimeout(b) ? 1 : 0
          cmp = aTo - bTo
          break
        }
      }
      return cmp * dirMul
    })
    return matches
  }, [members, search, filter, sort, rolePositionByMember, roleFilter])

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

  function openAction(kind: ActionKind, member: DiscordMember) {
    setOpenMenu(null)
    setDialogError(null)
    setPending({ kind, member })
  }

  async function runPending(values: Record<string, string>) {
    if (!pending) return
    setBusy(true)
    setDialogError(null)
    const m = pending.member
    const target: ActionTarget = {
      id: m.user.id,
      displayName: m.nick ?? m.user.global_name,
      username: m.user.username,
    }
    const toastLabel = memberDisplayName(m)
    const reason = values.reason?.trim() || undefined

    let result: ActionResult
    switch (pending.kind) {
      case 'timeout': {
        const minutes = Number(values.duration) || 0
        if (minutes <= 0) {
          setBusy(false)
          setDialogError('Pick a duration.')
          return
        }
        result = await timeoutMember(guildId, target, minutes, reason)
        break
      }
      case 'remove_timeout':
        result = await removeMemberTimeout(guildId, target, reason)
        break
      case 'kick':
        result = await kickMember(guildId, target, reason)
        break
      case 'ban': {
        const seconds = Number(values.delete_seconds) || 0
        result = await banMember(guildId, target, {
          reason,
          deleteMessageSeconds: seconds,
        })
        break
      }
      case 'warn': {
        if (!reason) {
          setBusy(false)
          setDialogError('A reason is required for warnings.')
          return
        }
        result = await warnMember(guildId, target, reason)
        break
      }
      case 'nickname': {
        result = await setMemberNickname(guildId, target, values.nickname ?? '', reason)
        break
      }
      case 'add_role': {
        const roleId = values.role_id || pending.preselectedRoleId
        if (!roleId) {
          setBusy(false)
          setDialogError('Pick a role.')
          return
        }
        const role = roles.find((r) => r.id === roleId) ?? null
        result = await addMemberRole(guildId, target, roleId, role?.name ?? null, reason)
        break
      }
      case 'remove_role': {
        const roleId = values.role_id || pending.preselectedRoleId
        if (!roleId) {
          setBusy(false)
          setDialogError('Pick a role.')
          return
        }
        const role = roles.find((r) => r.id === roleId) ?? null
        result = await removeMemberRole(guildId, target, roleId, role?.name ?? null, reason)
        break
      }
    }

    setBusy(false)
    if (!result.ok) {
      setDialogError(result.error)
      return
    }
    setToast({ kind: 'ok', text: `${ACTION_LABELS[pending.kind]} — ${toastLabel}` })
    setPending(null)
    onActionComplete()
  }

  function dialogConfig() {
    if (!pending) return null
    const m = pending.member
    const name = memberDisplayName(m)
    switch (pending.kind) {
      case 'timeout':
        return {
          title: `Timeout ${name}`,
          description: `${name} won't be able to send messages, react, or join voice for the chosen duration.`,
          tone: 'warning' as const,
          confirmLabel: 'Apply timeout',
          fields: [
            {
              key: 'duration',
              kind: 'select' as const,
              label: 'Duration',
              defaultValue: '10',
              options: TIMEOUT_OPTIONS,
            },
            {
              key: 'reason',
              kind: 'text' as const,
              label: 'Reason (optional)',
              placeholder: 'Reason shown in the audit log',
              maxLength: 500,
            },
          ],
        }
      case 'remove_timeout':
        return {
          title: `Remove timeout from ${name}`,
          description: `${name} will be able to participate again immediately.`,
          tone: 'default' as const,
          confirmLabel: 'Remove timeout',
          fields: [
            {
              key: 'reason',
              kind: 'text' as const,
              label: 'Reason (optional)',
              maxLength: 500,
            },
          ],
        }
      case 'kick':
        return {
          title: `Kick ${name}`,
          description: 'They will be removed from the server but can rejoin with an invite.',
          tone: 'destructive' as const,
          confirmLabel: 'Kick member',
          fields: [
            {
              key: 'reason',
              kind: 'text' as const,
              label: 'Reason (optional)',
              maxLength: 500,
            },
          ],
        }
      case 'ban':
        return {
          title: `Ban ${name}`,
          description: 'They will be removed and unable to rejoin until you unban them.',
          tone: 'destructive' as const,
          confirmLabel: 'Ban member',
          fields: [
            {
              key: 'delete_seconds',
              kind: 'select' as const,
              label: 'Delete recent messages',
              defaultValue: '0',
              options: BAN_DELETE_OPTIONS,
            },
            {
              key: 'reason',
              kind: 'text' as const,
              label: 'Reason (optional)',
              maxLength: 500,
            },
          ],
        }
      case 'warn':
        return {
          title: `Warn ${name}`,
          description: 'Recorded in moderation logs and visible to other moderators.',
          tone: 'warning' as const,
          confirmLabel: 'Save warning',
          fields: [
            {
              key: 'reason',
              kind: 'textarea' as const,
              label: 'Reason',
              placeholder: 'What did they do?',
              required: true,
              maxLength: 500,
            },
          ],
        }
      case 'nickname':
        return {
          title: `Change nickname for ${name}`,
          description: 'Leave blank to clear the nickname.',
          tone: 'default' as const,
          confirmLabel: 'Save nickname',
          fields: [
            {
              key: 'nickname',
              kind: 'text' as const,
              label: 'Nickname',
              defaultValue: m.nick ?? '',
              maxLength: 32,
            },
            {
              key: 'reason',
              kind: 'text' as const,
              label: 'Reason (optional)',
              maxLength: 500,
            },
          ],
        }
      case 'add_role': {
        const memberRoleIds = new Set(m.roles)
        const options = sortedRoles
          .filter((r) => !memberRoleIds.has(r.id))
          .map((r) => ({ label: r.name, value: r.id }))
        return {
          title: `Add role to ${name}`,
          description: options.length === 0 ? 'This member already has every assignable role.' : undefined,
          tone: 'default' as const,
          confirmLabel: 'Add role',
          fields: options.length === 0 ? [] : [
            {
              key: 'role_id',
              kind: 'select' as const,
              label: 'Role',
              defaultValue: options[0].value,
              options,
            },
            {
              key: 'reason',
              kind: 'text' as const,
              label: 'Reason (optional)',
              maxLength: 500,
            },
          ],
        }
      }
      case 'remove_role': {
        const options = sortedRoles
          .filter((r) => m.roles.includes(r.id))
          .map((r) => ({ label: r.name, value: r.id }))
        return {
          title: `Remove role from ${name}`,
          description: options.length === 0 ? 'This member has no removable roles.' : undefined,
          tone: 'default' as const,
          confirmLabel: 'Remove role',
          fields: options.length === 0 ? [] : [
            {
              key: 'role_id',
              kind: 'select' as const,
              label: 'Role',
              defaultValue: options[0].value,
              options,
            },
            {
              key: 'reason',
              kind: 'text' as const,
              label: 'Reason (optional)',
              maxLength: 500,
            },
          ],
        }
      }
    }
  }

  const dlg = dialogConfig()

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 pr-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-[448px]">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />

            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search members…"
              className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
              style={{
                background: 'var(--bg-2)',
                borderColor: 'var(--line-strong)',
                color: 'var(--text)',
              }}
            />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value)
              setPage(1)
            }}
            className="min-w-[150px] rounded-lg border px-2.5 py-2 pr-8 text-xs focus:outline-none focus:ring-1"
            style={{
              background: 'var(--bg-2)',
              borderColor: roleFilter ? 'var(--p-1)' : 'var(--line-strong)',
              color: roleFilter ? 'var(--p-1)' : 'var(--text-2)',
              backgroundPosition: 'right 10px center',
            }}
            title="Filter by role"
          >
            <option value="">All roles</option>

            {sortedRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div
          className="flex items-center gap-1 rounded-lg border p-1"
          style={{ borderColor: 'var(--line-strong)' }}
        >
          {(['all', 'no_bots'] as const).map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f)
                setPage(1)
              }}
              className="rounded-md px-3 py-1 text-xs font-medium transition"
              style={{
                background: filter === f ? 'var(--p-soft)' : 'transparent',
                color: filter === f ? 'var(--p-1)' : 'var(--text-3)',
              }}
            >
              {f === 'all' ? 'All' : 'No bots'}
            </button>
          ))}
        </div>
      </div>

      {toast && (
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: toast.kind === 'ok' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
            background: toast.kind === 'ok' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            color: toast.kind === 'ok' ? '#4ade80' : '#f87171',
          }}
        >
          {toast.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {toast.text}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={36} />}
          title="No members match"
          description={search ? `No members matching "${search}".` : 'No members in this view.'}
        />
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                <th className="text-left">
                  <SortableHeader label="Member" columnKey="name" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
                <th className="text-left">
                  <SortableHeader label="Roles" columnKey="role" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
                <th className="text-left">
                  <SortableHeader label="Joined" columnKey="joined" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
                <th className="text-left">
                  <SortableHeader label="Status" columnKey="status" activeKey={sort.key} direction={sort.dir} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-subtle">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((m) => {
                const av = avatarUrl(m.user.id, m.user.avatar)
                const lines = memberLines(m)
                const name = memberDisplayName(m)
                const inTimeout = isInTimeout(m)
                const memberRoles = sortedRoles.filter((r) => m.roles.includes(r.id))
                const visibleRoles = memberRoles.slice(0, 3)
                const hiddenRoles = memberRoles.slice(3)
                const extraRoles = hiddenRoles.length

                return (
                  <tr
                    key={m.user.id}
                    className="border-b"
                    style={{
                      borderColor: 'var(--line-strong)',
                      background: 'color-mix(in srgb, var(--panel) 50%, transparent)',
                    }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Image src={av} alt={name} width={28} height={28} className="rounded-full shrink-0" unoptimized />
                        <div className="min-w-0">
                          <p className="truncate text-foreground">
                            {lines.top}
                            {m.user.bot && (
                              <span className="ml-1.5 rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                                BOT
                              </span>
                            )}
                          </p>
                          <p
                            className={`truncate text-xs text-subtle ${lines.bottomIsId ? 'font-mono' : ''}`}
                          >
                            {lines.bottom}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {visibleRoles.map((r) => (
                          <span
                            key={r.id}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
                            style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                          >
                            <span className="h-2 w-2 rounded-full" style={{ background: roleColor(r.color) }} />
                            {r.name}
                          </span>
                        ))}
                        {extraRoles > 0 && (
                          <span
                            className="cursor-help text-xs text-subtle"
                            title={hiddenRoles.map((r) => r.name).join(', ')}
                          >
                            +{extraRoles}
                          </span>
                        )}
                        {memberRoles.length === 0 && (
                          <span className="text-xs text-subtle">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-subtle text-xs font-mono">
                      {new Date(m.joined_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {inTimeout ? (
                        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                          <Clock size={10} />
                          Timed out
                        </span>
                      ) : (
                        <span className="text-xs text-subtle">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          if (openMenu?.userId === m.user.id) {
                            setOpenMenu(null)
                            return
                          }
                          const r = e.currentTarget.getBoundingClientRect()
                          setOpenMenu({
                            userId: m.user.id,
                            rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
                          })
                        }}
                        className="inline-flex items-center justify-center rounded-lg border p-1.5 transition"
                        style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
                        aria-label={`Actions for ${name}`}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--bg-2)'
                          e.currentTarget.style.color = 'var(--text)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = ''
                          e.currentTarget.style.color = 'var(--text-3)'
                        }}
                      >
                        <MoreHorizontal size={14} />
                      </button>
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

      {openMenu && (() => {
        const member = filtered.find((m) => m.user.id === openMenu.userId)
        if (!member) return null
        return createPortal(
          <ActionMenu
            ref={menuRef}
            member={member}
            inTimeout={isInTimeout(member)}
            triggerRect={openMenu.rect}
            onPick={(kind) => openAction(kind, member)}
          />,
          document.body,
        )
      })()}

      {pending && dlg && (
        <ConfirmDialog
          title={dlg.title}
          description={dlg.description}
          tone={dlg.tone}
          confirmLabel={dlg.confirmLabel}
          fields={dlg.fields}
          busy={busy}
          error={dialogError}
          onCancel={() => {
            if (busy) return
            setPending(null)
            setDialogError(null)
          }}
          onConfirm={runPending}
        />
      )}
    </div>
  )
}

const ACTION_LABELS: Record<ActionKind, string> = {
  timeout: 'Timed out',
  remove_timeout: 'Timeout removed',
  kick: 'Kicked',
  ban: 'Banned',
  warn: 'Warned',
  nickname: 'Nickname changed',
  add_role: 'Role added',
  remove_role: 'Role removed',
}

type ActionMenuProps = {
  ref?: React.Ref<HTMLDivElement>
  member: DiscordMember
  inTimeout: boolean
  triggerRect: { top: number; left: number; right: number; bottom: number }
  onPick: (kind: ActionKind) => void
}

const MENU_WIDTH = 200
const MENU_GAP = 6

function ActionMenu({ ref, member, inTimeout, triggerRect, onPick }: ActionMenuProps) {
  const items: { key: ActionKind; label: string; icon: React.ReactNode; tone?: 'destructive' | 'warning' | 'foreground' }[] = [
    inTimeout
      ? { key: 'remove_timeout', label: 'Remove timeout', icon: <Clock size={12} />, tone: 'foreground' }
      : { key: 'timeout', label: 'Timeout…', icon: <Clock size={12} />, tone: 'warning' },
    { key: 'warn', label: 'Warn…', icon: <AlertCircle size={12} />, tone: 'warning' },
    { key: 'nickname', label: 'Change nickname…', icon: <Edit3 size={12} />, tone: 'foreground' },
    { key: 'add_role', label: 'Add role…', icon: <Plus size={12} />, tone: 'foreground' },
    { key: 'remove_role', label: 'Remove role…', icon: <Minus size={12} />, tone: 'foreground' },
    { key: 'kick', label: 'Kick…', icon: <UserMinus size={12} />, tone: 'destructive' },
    { key: 'ban', label: 'Ban…', icon: <Ban size={12} />, tone: 'destructive' },
  ]

  // Position: anchor right edge to the trigger's right edge, drop below by default;
  // flip above if there isn't enough room.
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 0
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 0
  const estimatedHeight = items.length * 28 + (member.user.bot ? 28 : 0) + 8
  const dropBelow = triggerRect.bottom + estimatedHeight + MENU_GAP < viewportH
  const top = dropBelow
    ? triggerRect.bottom + MENU_GAP
    : Math.max(8, triggerRect.top - estimatedHeight - MENU_GAP)
  const right = Math.max(8, viewportW - triggerRect.right)

  function colorFor(tone?: 'destructive' | 'warning' | 'foreground'): string {
    if (tone === 'destructive') return '#f87171'
    if (tone === 'warning') return '#f59e0b'
    return 'var(--text)'
  }

  return (
    <div
      ref={ref}
      role="menu"
      className="rounded-lg border py-1 shadow-xl"
      style={{
        position: 'fixed',
        top,
        right,
        width: MENU_WIDTH,
        zIndex: 60,
        background: 'var(--panel)',
        borderColor: 'var(--line-strong)',
      }}
    >
      {member.user.bot && (
        <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-subtle">
          <Crown size={10} className="inline mr-1 -mt-0.5" />
          Bot account
        </p>
      )}
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onPick(it.key)}
          className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs transition"
          style={{ color: colorFor(it.tone) }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  )
}

