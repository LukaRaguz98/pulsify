'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import {
  UserPlus, Trash2, Activity as ActivityIcon, X, Copy, Check, Link2, Loader2, Clock,
  TrendingUp, Users as UsersIcon, Crown, MailPlus,
} from 'lucide-react'
import {
  ROLE_BADGE, ROLE_LABELS, ROLE_RANK, assignableRoles, timeAgo, isInviteUsable,
  ACTIVITY_CATEGORY_ACCENT,
  type WorkspaceInvite, type WorkspaceMember, type WorkspaceRole, type WorkspaceActivityRow,
} from '@/lib/workspace'
import { useWorkspace } from '@/components/workspace/WorkspaceProvider'
import { useRunAction, FeedbackBanner, Avatar } from '@/components/workspace/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  createInvite, revokeInvite, changeMemberRole, removeMember, getMemberActivity,
} from '@/app/workspace/[workspaceId]/team/actions'

export function TeamContent({
  members, invites, activityCounts,
}: {
  members: WorkspaceMember[]
  invites: WorkspaceInvite[]
  activityCounts: Record<string, number>
}) {
  const { workspace, role, meId, can } = useWorkspace()
  const router = useRouter()
  const { busy, feedback, setFeedback, run } = useRunAction()
  const canManage = can('manageMembers')

  const [inviting, setInviting] = useState(false)
  const [removingMember, setRemovingMember] = useState<WorkspaceMember | null>(null)
  const [activityFor, setActivityFor] = useState<WorkspaceMember | null>(null)

  const canActOn = (m: WorkspaceMember) =>
    canManage && m.user_id !== meId && m.role !== 'owner' &&
    (role === 'owner' || ROLE_RANK[m.role] < ROLE_RANK[role])

  const assignable = assignableRoles(role)

  const ownerCount = members.filter((m) => m.role === 'owner').length
  const adminCount = members.filter((m) => m.role === 'admin').length
  const activeInvites = invites.filter((i) => isInviteUsable(i)).length

  const stats = [
    { label: 'Members', value: members.length, icon: <UsersIcon size={16} /> },
    { label: 'Owners', value: ownerCount, icon: <Crown size={16} /> },
    { label: 'Admins', value: adminCount, icon: <Crown size={16} /> },
    { label: 'Active invites', value: activeInvites, icon: <MailPlus size={16} /> },
  ]

  return (
    <div className="page-content">
      <PageHeader
        title="Team"
        helpId="workspace-team"
        description="Invite teammates and manage their workspace roles and permissions."
        action={canManage ? (
          <button type="button" onClick={() => setInviting(true)} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
            <UserPlus size={15} /> Invite member
          </button>
        ) : undefined}
      />

      <FeedbackBanner feedback={feedback} onClose={() => setFeedback(null)} />

      <div className="space-y-8">
      <CategorySection
        icon={<TrendingUp size={14} />}
        title="At a glance"
        description="Snapshot of who's on the team and how many invites are out."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><span style={{ color: 'var(--p-1)' }}>{s.icon}</span>{s.label}</div>
              <p className="mt-2 text-2xl font-bold text-foreground">{s.value}</p>
            </div>
          ))}
        </div>
      </CategorySection>

      <CategorySection
        icon={<UsersIcon size={14} />}
        title="Members"
        description="Manage workspace roles and review per-member activity."
      >
      {/* Members */}
      <section className="rounded-xl border" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="border-b px-5 py-3.5" style={{ borderColor: 'var(--line-strong)' }}>
          <h2 className="font-semibold text-foreground">Members <span className="text-sm font-normal" style={{ color: 'var(--text-3)' }}>· {members.length}</span></h2>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--line-strong)' }}>
          {members.map((m) => {
            const badge = ROLE_BADGE[m.role]
            const actable = canActOn(m)
            return (
              <div key={m.user_id} className="flex items-center gap-3 px-5 py-3" style={{ borderColor: 'var(--line-strong)' }}>
                <Avatar name={m.display_name} url={m.avatar_url} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {m.display_name ?? 'Member'}{m.user_id === meId && <span className="ml-1.5 text-xs" style={{ color: 'var(--text-3)' }}>(you)</span>}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>{activityCounts[m.user_id] ?? 0} recent action{(activityCounts[m.user_id] ?? 0) === 1 ? '' : 's'} · joined {timeAgo(m.joined_at)}</p>
                </div>

                {actable ? (
                  <select
                    value={m.role}
                    disabled={busy}
                    onChange={async (e) => {
                      const res = await run(() => changeMemberRole(workspace.id, m.user_id, e.target.value), 'Role updated.')
                      if (res.ok) router.refresh()
                    }}
                    className="rounded-lg border px-2 py-1 text-xs font-medium focus:outline-none"
                    style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                  >
                    {/* Current role first so it always shows even if above assignable ceiling. */}
                    {[...new Set([m.role, ...assignable])].map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r as WorkspaceRole]}</option>
                    ))}
                  </select>
                ) : (
                  <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>{ROLE_LABELS[m.role]}</span>
                )}

                <button type="button" onClick={() => setActivityFor(m)} title="View activity" className="rounded-md p-1.5 transition hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-3)' }}>
                  <ActivityIcon size={15} />
                </button>
                {actable && (
                  <button type="button" onClick={() => setRemovingMember(m)} title="Remove" className="rounded-md p-1.5 transition hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-3)' }}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </section>

      </CategorySection>

      {/* Invites */}
      {canManage && (
        <CategorySection
          icon={<MailPlus size={14} />}
          title="Pending invites"
          description="Outstanding invite links — share with teammates so they can join the workspace."
        >
          <section className="rounded-xl border" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            {invites.length === 0 ? (
              <p className="px-5 py-6 text-sm" style={{ color: 'var(--text-3)' }}>No active invites. Create one to add teammates.</p>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--line-strong)' }}>
                {invites.map((inv) => <InviteRow key={inv.id} invite={inv} busy={busy} onRevoke={async () => { const res = await run(() => revokeInvite(workspace.id, inv.id), 'Invite revoked.'); if (res.ok) router.refresh() }} />)}
              </div>
            )}
          </section>
        </CategorySection>
      )}
      </div>

      {inviting && (
        <InviteModal
          assignable={assignable}
          busy={busy}
          error={feedback?.kind === 'error' ? feedback.text : null}
          onClose={() => setInviting(false)}
          onCreate={async (input) => {
            const res = await run(() => createInvite(workspace.id, input), 'Invite created.')
            if (res.ok) router.refresh()
            return res.ok ? res.data.code : null
          }}
        />
      )}

      {removingMember && (
        <ConfirmDialog
          title={`Remove ${removingMember.display_name ?? 'member'}?`}
          description="They'll immediately lose access to this workspace. Their notes, tasks and activity history are kept."
          confirmLabel="Remove member"
          tone="destructive"
          busy={busy}
          error={feedback?.kind === 'error' ? feedback.text : null}
          onCancel={() => setRemovingMember(null)}
          onConfirm={async () => {
            const res = await run(() => removeMember(workspace.id, removingMember.user_id), 'Member removed.')
            if (res.ok) { setRemovingMember(null); router.refresh() }
          }}
        />
      )}

      {activityFor && <MemberActivityDrawer member={activityFor} workspaceId={workspace.id} onClose={() => setActivityFor(null)} />}
    </div>
  )
}

function InviteRow({ invite, busy, onRevoke }: { invite: WorkspaceInvite; busy: boolean; onRevoke: () => void }) {
  const [copied, setCopied] = useState(false)
  const usable = isInviteUsable(invite)
  function copy() {
    const url = `${window.location.origin}/workspace/join/${invite.code}`
    navigator.clipboard?.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--bg-2)', color: 'var(--p-1)' }}><Link2 size={15} /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{invite.label ?? 'Invite link'} · <span style={{ color: 'var(--text-3)' }}>{ROLE_LABELS[invite.role]}</span></p>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          {invite.uses} used{invite.max_uses ? ` / ${invite.max_uses}` : ''}
          {invite.expires_at ? ` · expires ${timeAgo(invite.expires_at)}` : ''}
          {!usable && ' · expired'}
        </p>
      </div>
      <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
        {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy link'}
      </button>
      <button type="button" onClick={onRevoke} disabled={busy} title="Revoke" className="rounded-md p-1.5 transition hover:bg-[var(--bg-2)] disabled:opacity-50" style={{ color: 'var(--text-3)' }}><Trash2 size={15} /></button>
    </div>
  )
}

function InviteModal({
  assignable, busy, error, onClose, onCreate,
}: {
  assignable: WorkspaceRole[]
  busy: boolean
  error: string | null
  onClose: () => void
  onCreate: (input: { role: string; label?: string; expiresInDays?: number; maxUses?: number }) => Promise<string | null>
}) {
  const [role, setRole] = useState<WorkspaceRole>(assignable[assignable.length - 1] ?? 'support')
  const [label, setLabel] = useState('')
  const [expiresInDays, setExpires] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [createdCode, setCreatedCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (typeof document === 'undefined') return null

  const inviteUrl = createdCode ? `${window.location.origin}/workspace/join/${createdCode}` : ''

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <h2 className="font-semibold text-foreground">Invite a teammate</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground transition hover:text-foreground" aria-label="Close"><X size={16} /></button>
        </div>

        {createdCode ? (
          <div className="px-5 py-5">
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>Share this link with your teammate. They&apos;ll sign in with Discord to join.</p>
            <div className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
              <span className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--text-2)' }}>{inviteUrl}</span>
              <button type="button" onClick={() => { navigator.clipboard?.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white" style={{ background: 'var(--p-1)' }}>
                {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button type="button" onClick={onClose} className="mt-5 w-full rounded-lg border py-2 text-sm font-medium text-foreground" style={{ borderColor: 'var(--line-strong)' }}>Done</button>
          </div>
        ) : (
          <>
            <div className="space-y-4 px-5 py-5">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                  {assignable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Label <span style={{ color: 'var(--text-3)' }}>(optional)</span></label>
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. New mod intake" maxLength={80} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Expires in (days)</label>
                  <input value={expiresInDays} onChange={(e) => setExpires(e.target.value)} type="number" min={0} placeholder="Never" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Max uses</label>
                  <input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} type="number" min={0} placeholder="Unlimited" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
                </div>
              </div>
              {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
              <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground" style={{ borderColor: 'var(--line-strong)' }}>Cancel</button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const code = await onCreate({ role, label: label || undefined, expiresInDays: Number(expiresInDays) || undefined, maxUses: Number(maxUses) || undefined })
                  if (code) setCreatedCode(code)
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
              >
                {busy && <Loader2 size={14} className="animate-spin" />}Create invite
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

function MemberActivityDrawer({ member, workspaceId, onClose }: { member: WorkspaceMember; workspaceId: string; onClose: () => void }) {
  const [rows, setRows] = useState<WorkspaceActivityRow[] | null>(null)

  useEffect(() => {
    let active = true
    getMemberActivity(workspaceId, member.user_id).then((res) => {
      if (active) setRows(res.ok ? res.data.rows : [])
    })
    return () => { active = false }
  }, [workspaceId, member.user_id])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-lg max-h-[90vh] flex-col rounded-2xl border shadow-2xl overflow-hidden" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <Avatar name={member.display_name} url={member.avatar_url} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-foreground">{member.display_name ?? 'Member'}</p>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{ROLE_LABELS[member.role]} · activity log</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground transition hover:text-foreground"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {rows === null ? (
            <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-3)' }}><Loader2 size={14} className="animate-spin" /> Loading…</p>
          ) : rows.length === 0 ? (
            <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-3)' }}><Clock size={14} /> No recorded activity yet.</p>
          ) : (
            <div className="space-y-3">
              {rows.map((a) => (
                <div key={a.id} className="flex gap-2.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: ACTIVITY_CATEGORY_ACCENT[a.category] ?? 'var(--p-1)' }} />
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{a.summary ?? a.action}</p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>{timeAgo(a.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
