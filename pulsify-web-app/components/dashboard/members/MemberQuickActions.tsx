'use client'

import { useState } from 'react'
import { Clock, AlertCircle, Edit3, Plus, Minus, UserMinus, Ban } from 'lucide-react'
import { ConfirmDialog, type FieldDef } from '@/components/ui/confirm-dialog'
import type { DiscordMember, DiscordRole } from '@/lib/discord'
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

type ActionKind =
  | 'timeout'
  | 'remove_timeout'
  | 'kick'
  | 'ban'
  | 'warn'
  | 'nickname'
  | 'add_role'
  | 'remove_role'

type Props = {
  guildId: string
  member: DiscordMember
  roles: DiscordRole[]
  inTimeout: boolean
  /** Called after a successful action with a short label, so the page refreshes. */
  onActionComplete: (label: string) => void
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

function displayName(m: DiscordMember): string {
  return m.nick ?? m.user.global_name ?? m.user.username
}

export function MemberQuickActions({ guildId, member, roles, inTimeout, onActionComplete }: Props) {
  const [pending, setPending] = useState<ActionKind | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const sortedRoles = roles
    .filter((r) => r.name !== '@everyone' && !r.managed)
    .sort((a, b) => b.position - a.position)
  const name = displayName(member)

  const buttons: { kind: ActionKind; label: string; icon: React.ReactNode; tone: 'default' | 'warning' | 'destructive' }[] = [
    { kind: 'warn', label: 'Warn', icon: <AlertCircle size={14} />, tone: 'warning' },
    inTimeout
      ? { kind: 'remove_timeout', label: 'Remove timeout', icon: <Clock size={14} />, tone: 'default' }
      : { kind: 'timeout', label: 'Timeout', icon: <Clock size={14} />, tone: 'warning' },
    { kind: 'add_role', label: 'Add role', icon: <Plus size={14} />, tone: 'default' },
    { kind: 'remove_role', label: 'Remove role', icon: <Minus size={14} />, tone: 'default' },
    { kind: 'nickname', label: 'Nickname', icon: <Edit3 size={14} />, tone: 'default' },
    { kind: 'kick', label: 'Kick', icon: <UserMinus size={14} />, tone: 'destructive' },
    { kind: 'ban', label: 'Ban', icon: <Ban size={14} />, tone: 'destructive' },
  ]

  function open(kind: ActionKind) {
    setDialogError(null)
    setPending(kind)
  }

  async function run(values: Record<string, string>) {
    if (!pending) return
    setBusy(true)
    setDialogError(null)
    const target: ActionTarget = {
      id: member.user.id,
      displayName: member.nick ?? member.user.global_name,
      username: member.user.username,
    }
    const reason = values.reason?.trim() || undefined

    let result: ActionResult
    switch (pending) {
      case 'timeout': {
        const minutes = Number(values.duration) || 0
        if (minutes <= 0) { setBusy(false); setDialogError('Pick a duration.'); return }
        result = await timeoutMember(guildId, target, minutes, reason)
        break
      }
      case 'remove_timeout':
        result = await removeMemberTimeout(guildId, target, reason)
        break
      case 'kick':
        result = await kickMember(guildId, target, reason)
        break
      case 'ban':
        result = await banMember(guildId, target, { reason, deleteMessageSeconds: Number(values.delete_seconds) || 0 })
        break
      case 'warn': {
        if (!reason) { setBusy(false); setDialogError('A reason is required for warnings.'); return }
        result = await warnMember(guildId, target, reason)
        break
      }
      case 'nickname':
        result = await setMemberNickname(guildId, target, values.nickname ?? '', reason)
        break
      case 'add_role': {
        const roleId = values.role_id
        if (!roleId) { setBusy(false); setDialogError('Pick a role.'); return }
        result = await addMemberRole(guildId, target, roleId, roles.find((r) => r.id === roleId)?.name ?? null, reason)
        break
      }
      case 'remove_role': {
        const roleId = values.role_id
        if (!roleId) { setBusy(false); setDialogError('Pick a role.'); return }
        result = await removeMemberRole(guildId, target, roleId, roles.find((r) => r.id === roleId)?.name ?? null, reason)
        break
      }
    }

    setBusy(false)
    if (!result.ok) { setDialogError(result.error); return }
    const label = `${ACTION_LABELS[pending]} — ${name}`
    setPending(null)
    onActionComplete(label)
  }

  const dlg = pending ? dialogConfig(pending, member, name, sortedRoles) : null

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {buttons.map((b) => (
          <button
            key={b.kind}
            onClick={() => open(b.kind)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition"
            style={{
              borderColor:
                b.tone === 'destructive' ? 'rgba(239,68,68,0.4)' : b.tone === 'warning' ? 'rgba(245,158,11,0.4)' : 'var(--line-strong)',
              color: b.tone === 'destructive' ? '#f87171' : b.tone === 'warning' ? '#f59e0b' : 'var(--text-2)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
          >
            {b.icon}
            {b.label}
          </button>
        ))}
      </div>

      {pending && dlg && (
        <ConfirmDialog
          title={dlg.title}
          description={dlg.description}
          tone={dlg.tone}
          confirmLabel={dlg.confirmLabel}
          fields={dlg.fields}
          busy={busy}
          error={dialogError}
          onCancel={() => { if (!busy) { setPending(null); setDialogError(null) } }}
          onConfirm={run}
        />
      )}
    </>
  )
}

function dialogConfig(
  kind: ActionKind,
  member: DiscordMember,
  name: string,
  sortedRoles: DiscordRole[],
): { title: string; description?: string; tone: 'default' | 'warning' | 'destructive'; confirmLabel: string; fields: FieldDef[] } {
  const reasonField: FieldDef = { key: 'reason', kind: 'text', label: 'Reason (optional)', placeholder: 'Shown in the audit log', maxLength: 500 }
  switch (kind) {
    case 'timeout':
      return {
        title: `Timeout ${name}`,
        description: `${name} won't be able to send messages, react, or join voice for the chosen duration.`,
        tone: 'warning',
        confirmLabel: 'Apply timeout',
        fields: [{ key: 'duration', kind: 'select', label: 'Duration', defaultValue: '10', options: TIMEOUT_OPTIONS }, reasonField],
      }
    case 'remove_timeout':
      return { title: `Remove timeout from ${name}`, description: `${name} will be able to participate again immediately.`, tone: 'default', confirmLabel: 'Remove timeout', fields: [reasonField] }
    case 'kick':
      return { title: `Kick ${name}`, description: 'They will be removed from the server but can rejoin with an invite.', tone: 'destructive', confirmLabel: 'Kick member', fields: [reasonField] }
    case 'ban':
      return {
        title: `Ban ${name}`,
        description: 'They will be removed and unable to rejoin until you unban them.',
        tone: 'destructive',
        confirmLabel: 'Ban member',
        fields: [{ key: 'delete_seconds', kind: 'select', label: 'Delete recent messages', defaultValue: '0', options: BAN_DELETE_OPTIONS }, reasonField],
      }
    case 'warn':
      return {
        title: `Warn ${name}`,
        description: 'Recorded in moderation history and visible to other moderators.',
        tone: 'warning',
        confirmLabel: 'Save warning',
        fields: [{ key: 'reason', kind: 'textarea', label: 'Reason', placeholder: 'What did they do?', required: true, maxLength: 500 }],
      }
    case 'nickname':
      return {
        title: `Change nickname for ${name}`,
        description: 'Leave blank to clear the nickname.',
        tone: 'default',
        confirmLabel: 'Save nickname',
        fields: [{ key: 'nickname', kind: 'text', label: 'Nickname', defaultValue: member.nick ?? '', maxLength: 32 }, reasonField],
      }
    case 'add_role': {
      const memberRoleIds = new Set(member.roles)
      const options = sortedRoles.filter((r) => !memberRoleIds.has(r.id)).map((r) => ({ label: r.name, value: r.id }))
      return {
        title: `Add role to ${name}`,
        description: options.length === 0 ? 'This member already has every assignable role.' : undefined,
        tone: 'default',
        confirmLabel: 'Add role',
        fields: options.length === 0 ? [] : [{ key: 'role_id', kind: 'select', label: 'Role', defaultValue: options[0].value, options }, reasonField],
      }
    }
    case 'remove_role': {
      const options = sortedRoles.filter((r) => member.roles.includes(r.id)).map((r) => ({ label: r.name, value: r.id }))
      return {
        title: `Remove role from ${name}`,
        description: options.length === 0 ? 'This member has no removable roles.' : undefined,
        tone: 'default',
        confirmLabel: 'Remove role',
        fields: options.length === 0 ? [] : [{ key: 'role_id', kind: 'select', label: 'Role', defaultValue: options[0].value, options }, reasonField],
      }
    }
  }
}
