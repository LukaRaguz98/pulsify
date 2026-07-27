'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { X, Loader2, Search, AlertTriangle, Clock, Calendar } from 'lucide-react'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import { avatarUrl, type DiscordRole } from '@/lib/discord'
import {
  addDuration,
  formatRemaining,
  TEMP_ROLE_SOURCES,
  TEMP_ROLE_PRESETS,
  DURATION_UNITS,
  UNIT_LABELS,
  SOURCE_META,
  type DurationUnit,
  type TempRoleSource,
} from '@/lib/temporary-roles'

export type TempRoleMember = {
  user: { id: string; username: string; global_name: string | null; avatar: string | null }
  nick: string | null
}

type Props = {
  guildId: string
  roles: DiscordRole[]
  members: TempRoleMember[]
  onClose: () => void
  onAssigned: (msg: string) => void
}

function memberLabel(m: TempRoleMember): string {
  return m.nick ?? m.user.global_name ?? m.user.username
}

export function AssignTempRolePanel({ guildId, roles, members, onClose, onAssigned }: Props) {
  const [memberQuery, setMemberQuery] = useState('')
  const [member, setMember] = useState<TempRoleMember | null>(null)
  const [roleId, setRoleId] = useState('')
  const [source, setSource] = useState<TempRoleSource>('manual')
  const [mode, setMode] = useState<'duration' | 'date'>('duration')
  const [value, setValue] = useState(30)
  const [unit, setUnit] = useState<DurationUnit>('days')
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [notifyUser, setNotifyUser] = useState(true)
  const [notifyAdmin, setNotifyAdmin] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useDialogDismiss(onClose, busy)

  // Assignable roles: skip @everyone and managed (bot/integration) roles.
  const assignableRoles = useMemo(
    () => roles.filter((r) => r.name !== '@everyone' && !r.managed).sort((a, b) => b.position - a.position),
    [roles],
  )

  const memberMatches = useMemo(() => {
    const q = memberQuery.trim().toLowerCase()
    if (!q) return members.slice(0, 8)
    return members
      .filter((m) => memberLabel(m).toLowerCase().includes(q) || m.user.username.toLowerCase().includes(q))
      .slice(0, 8)
  }, [members, memberQuery])

  const previewExpiry = useMemo(() => {
    if (mode === 'date') return date ? new Date(date) : null
    return addDuration(new Date(), value, unit)
  }, [mode, date, value, unit])

  async function submit() {
    if (!member) { setError('Pick a member.'); return }
    if (!roleId) { setError('Pick a role.'); return }
    setBusy(true)
    setError(null)
    const payload: Record<string, unknown> = {
      userId: member.user.id,
      userName: memberLabel(member),
      roleId,
      source,
      reason,
      notifyUser,
      notifyAdmin,
    }
    if (mode === 'date') {
      if (!date) { setError('Pick an expiration date.'); setBusy(false); return }
      payload.expiresAt = new Date(date).toISOString()
    } else {
      payload.duration = { value, unit }
    }
    const res = await fetch(`/api/discord/guild/${guildId}/temporary-roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Could not assign the role.')
      return
    }
    onAssigned(`Granted @${assignableRoles.find((r) => r.id === roleId)?.name ?? 'role'} to ${memberLabel(member)}.`)
  }

  if (typeof document === 'undefined') return null

  const fieldStyle: React.CSSProperties = { background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assign a temporary role"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <h2 className="font-semibold text-foreground">Assign a temporary role</h2>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Member */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Member</label>
            {member ? (
              <div className="flex items-center gap-2 rounded-lg border px-3 py-2" style={fieldStyle}>
                <Image src={avatarUrl(member.user.id, member.user.avatar, '0', 32)} alt="" width={22} height={22} className="rounded-full" unoptimized />
                <span className="flex-1 truncate text-sm text-foreground">{memberLabel(member)}</span>
                <button type="button" onClick={() => setMember(null)} className="text-muted-foreground hover:text-foreground" aria-label="Change member"><X size={14} /></button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                  <input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Search members…" className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1" style={fieldStyle} />
                </div>
                {memberMatches.length > 0 && (
                  <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--line-strong)' }}>
                    {memberMatches.map((m) => (
                      <button key={m.user.id} type="button" onClick={() => { setMember(m); setMemberQuery('') }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--bg-2)]">
                        <Image src={avatarUrl(m.user.id, m.user.avatar, '0', 32)} alt="" width={20} height={20} className="rounded-full" unoptimized />
                        <span className="flex-1 truncate text-sm text-foreground">{memberLabel(m)}</span>
                        <span className="truncate text-xs" style={{ color: 'var(--text-3)' }}>@{m.user.username}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Role + source */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Role</label>
              <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle}>
                <option value="">Select a role…</option>
                {assignableRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Source</label>
              <select value={source} onChange={(e) => setSource(e.target.value as TempRoleSource)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle}>
                {TEMP_ROLE_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_META[s].label}</option>)}
              </select>
            </div>
          </div>

          {/* Presets */}
          <div className="flex flex-wrap gap-1.5">
            {TEMP_ROLE_PRESETS.map((p) => (
              <button key={p.label} type="button" onClick={() => { setMode('duration'); setValue(p.value); setUnit(p.unit); setSource(p.source) }} className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground" style={{ borderColor: 'var(--line-strong)' }}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Expiration */}
          <div>
            <div className="mb-1.5 flex items-center gap-3">
              <label className="text-xs font-medium text-muted-foreground">Expires</label>
              <div className="flex overflow-hidden rounded-lg border text-xs" style={{ borderColor: 'var(--line-strong)' }}>
                <button type="button" onClick={() => setMode('duration')} className="flex items-center gap-1 px-2 py-1" style={mode === 'duration' ? { background: 'var(--p-soft)', color: 'var(--p-1)' } : { color: 'var(--text-3)' }}><Clock size={12} /> Duration</button>
                <button type="button" onClick={() => setMode('date')} className="flex items-center gap-1 px-2 py-1" style={mode === 'date' ? { background: 'var(--p-soft)', color: 'var(--p-1)' } : { color: 'var(--text-3)' }}><Calendar size={12} /> Date</button>
              </div>
            </div>
            {mode === 'duration' ? (
              <div className="flex gap-2">
                <input type="number" min={1} value={value} onChange={(e) => setValue(Math.max(1, Number(e.target.value) || 1))} className="w-24 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle} />
                <select value={unit} onChange={(e) => setUnit(e.target.value as DurationUnit)} className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle}>
                  {DURATION_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
                </select>
              </div>
            ) : (
              <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle} />
            )}
            {previewExpiry && !Number.isNaN(previewExpiry.getTime()) && (
              <p className="mt-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
                Expires {previewExpiry.toLocaleString()} · in {formatRemaining(previewExpiry)}
              </p>
            )}
          </div>

          {/* Reason */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Reason (optional)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. VIP reward for the launch event" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle} />
          </div>

          {/* Notifications */}
          <div className="flex flex-wrap gap-4">
            {([['notifyUser', notifyUser, setNotifyUser, 'Notify member (DM)'], ['notifyAdmin', notifyAdmin, setNotifyAdmin, 'Notify admins']] as const).map(([key, val, set, label]) => (
              <button
                key={key}
                type="button"
                role="switch"
                aria-checked={val}
                onClick={() => set(!val)}
                className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
              >
                {/* Sliding toggle — the same switch the Permissions list and the
                    role editor use, so every bool control feels consistent. */}
                <span
                  className="relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200"
                  style={{ background: val ? 'var(--p-1)' : 'var(--line-strong)' }}
                >
                  <span
                    className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
                    style={{ transform: val ? 'translateX(16px)' : 'translateX(0)' }}
                  />
                </span>
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50" style={{ borderColor: 'var(--line-strong)' }}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
            {busy && <Loader2 size={13} className="animate-spin" />} Assign role
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
