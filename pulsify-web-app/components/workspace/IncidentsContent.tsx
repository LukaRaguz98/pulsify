'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { Plus, ShieldAlert, X, Loader2, Send, Trash2, MessageSquare, TrendingUp, Activity } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import {
  INCIDENT_STATUSES, INCIDENT_STATUS_LABELS, SEVERITIES, SEVERITY_COLOR, timeAgo,
  type IncidentComment, type IncidentStatus, type Severity, type WorkspaceIncident,
} from '@/lib/workspace'
import { useWorkspace } from '@/components/workspace/WorkspaceProvider'
import { useRealtimeRows } from '@/components/workspace/use-realtime'
import { useRunAction, FeedbackBanner, Avatar } from '@/components/workspace/feedback'
import { MentionText, MentionPicker } from '@/components/workspace/mentions'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  createIncident, updateIncident, deleteIncident, addIncidentComment, getIncidentComments,
} from '@/app/workspace/[workspaceId]/incidents/actions'

const STATUS_COLOR: Record<IncidentStatus, string> = { open: '#f87171', investigating: '#fbbf24', resolved: '#34d399', closed: '#94a3b8' }

export function IncidentsContent({ initialIncidents, serverNames }: { initialIncidents: WorkspaceIncident[]; serverNames: Record<string, string> }) {
  const { workspace, members, can } = useWorkspace()
  const { rows: incidents } = useRealtimeRows<WorkspaceIncident>('workspace_incidents', workspace.id, initialIncidents)
  const { busy, feedback, setFeedback, run } = useRunAction()
  const canManage = can('manageIncidents')

  const [filter, setFilter] = useState<'active' | IncidentStatus>('active')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const open = incidents.find((i) => i.id === openId) ?? null
  const visible = incidents.filter((i) => filter === 'active' ? (i.status === 'open' || i.status === 'investigating') : i.status === filter)
  const memberName = (id: string | null) => members.find((m) => m.user_id === id)?.display_name ?? null

  const openCount = incidents.filter((i) => i.status === 'open').length
  const investigatingCount = incidents.filter((i) => i.status === 'investigating').length
  const resolvedCount = incidents.filter((i) => i.status === 'resolved').length

  const stats = [
    { label: 'Incidents', value: incidents.length, icon: <ShieldAlert size={16} /> },
    { label: 'Open', value: openCount, icon: <ShieldAlert size={16} /> },
    { label: 'Investigating', value: investigatingCount, icon: <Activity size={16} /> },
    { label: 'Resolved', value: resolvedCount, icon: <ShieldAlert size={16} /> },
  ]

  return (
    <div className="page-content">
      <PageHeader
        title="Incidents"
        helpId="workspace-incidents"
        description="Track and resolve cross-server incidents together with status, severity and a comment thread."
        action={canManage ? (
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
            <Plus size={15} /> New incident
          </button>
        ) : undefined}
      />
      <FeedbackBanner feedback={feedback} onClose={() => setFeedback(null)} />

      <div className="space-y-8">
      <CategorySection
        icon={<TrendingUp size={14} />}
        title="At a glance"
        description="Snapshot of cross-server incidents and their current state."
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
        icon={<ShieldAlert size={14} />}
        title="Incidents"
        description="Filter by status, then click any incident to update it or post a comment."
      >
      <div className="flex flex-wrap gap-1.5">
        {(['active', ...INCIDENT_STATUSES] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className="rounded-full border px-3 py-1 text-xs font-medium capitalize transition" style={{ borderColor: filter === f ? 'var(--p-1)' : 'var(--line-strong)', background: filter === f ? 'var(--p-soft)' : 'transparent', color: filter === f ? 'var(--p-1)' : 'var(--text-2)' }}>
            {f === 'active' ? 'Active' : INCIDENT_STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={<ShieldAlert size={30} />} title="No incidents" description={filter === 'active' ? 'No active incidents — nice and quiet.' : 'Nothing here.'} />
      ) : (
        <div className="space-y-2">
          {visible.map((i) => (
            <button key={i.id} type="button" onClick={() => setOpenId(i.id)} className="flex w-full items-center gap-3 rounded-xl border p-4 text-left transition hover:border-[var(--p-1)]" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[i.severity] }} title={i.severity} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{i.title}</p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {i.guild_id ? `${serverNames[i.guild_id] ?? 'Server'} · ` : ''}{i.assignee_id ? `${memberName(i.assignee_id) ?? 'assigned'} · ` : ''}{timeAgo(i.created_at)}
                </p>
              </div>
              <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize" style={{ background: `${STATUS_COLOR[i.status]}22`, color: STATUS_COLOR[i.status] }}>{INCIDENT_STATUS_LABELS[i.status]}</span>
            </button>
          ))}
        </div>
      )}
      </CategorySection>
      </div>

      {creating && (
        <IncidentModal
          busy={busy}
          error={feedback?.kind === 'error' ? feedback.text : null}
          members={members.map((m) => ({ id: m.user_id, name: m.display_name ?? 'Member' }))}
          serverNames={serverNames}
          onClose={() => setCreating(false)}
          onCreate={async (input) => { const res = await run(() => createIncident(workspace.id, input), 'Incident opened.'); if (res.ok) setCreating(false) }}
        />
      )}

      {open && (
        <IncidentDrawer
          incident={open}
          canManage={canManage}
          busy={busy}
          serverName={open.guild_id ? serverNames[open.guild_id] ?? null : null}
          members={members.map((m) => ({ user_id: m.user_id, display_name: m.display_name, avatar_url: m.avatar_url }))}
          onClose={() => setOpenId(null)}
          run={run}
        />
      )}
    </div>
  )
}

type RunFn = ReturnType<typeof useRunAction>['run']

function IncidentDrawer({
  incident, canManage, busy, serverName, members, onClose, run,
}: {
  incident: WorkspaceIncident
  canManage: boolean
  busy: boolean
  serverName: string | null
  members: { user_id: string; display_name: string | null; avatar_url: string | null }[]
  onClose: () => void
  run: RunFn
}) {
  const { workspace } = useWorkspace()
  const [comments, setComments] = useState<IncidentComment[] | null>(null)
  const [body, setBody] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  // Load + live-subscribe to this incident's comments.
  useEffect(() => {
    let active = true
    const supabase = createClient()
    const load = () => getIncidentComments(workspace.id, incident.id).then((res) => { if (active && res.ok) setComments(res.data.comments) })
    load()
    const channel: RealtimeChannel = supabase
      .channel(`incident-comments:${incident.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_incident_comments', filter: `incident_id=eq.${incident.id}` }, load)
      .subscribe()
    return () => { active = false; supabase.removeChannel(channel) }
  }, [workspace.id, incident.id])

  function insertMention(name: string) { setBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}@${name} `); textRef.current?.focus() }

  async function send() {
    if (!body.trim()) return
    const res = await run(() => addIncidentComment(workspace.id, incident.id, body))
    if (res.ok) setBody('')
  }

  const memberName = (id: string | null) => members.find((m) => m.user_id === id)?.display_name ?? null
  const memberAvatar = (id: string | null) => members.find((m) => m.user_id === id)?.avatar_url ?? null

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-2xl max-h-[90vh] flex-col rounded-2xl border shadow-2xl overflow-hidden" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="flex items-start gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[incident.severity] }} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">{incident.title}</p>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{serverName ? `${serverName} · ` : ''}opened {timeAgo(incident.created_at)}</p>
          </div>
          {canManage && <button type="button" onClick={() => setConfirmDelete(true)} title="Delete" className="rounded-md p-1.5 transition hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-3)' }}><Trash2 size={15} /></button>}
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground transition hover:text-foreground"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Controls */}
          <div className="grid grid-cols-3 gap-2">
            <Field label="Status">
              <select disabled={!canManage || busy} value={incident.status} onChange={(e) => run(() => updateIncident(workspace.id, incident.id, { status: e.target.value }))} className="w-full rounded-lg border px-2 py-1.5 text-xs focus:outline-none disabled:opacity-70" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{INCIDENT_STATUS_LABELS[s]}</option>)}
              </select>
            </Field>
            <Field label="Severity">
              <select disabled={!canManage || busy} value={incident.severity} onChange={(e) => run(() => updateIncident(workspace.id, incident.id, { severity: e.target.value }))} className="w-full rounded-lg border px-2 py-1.5 text-xs capitalize focus:outline-none disabled:opacity-70" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Assignee">
              <select disabled={!canManage || busy} value={incident.assignee_id ?? ''} onChange={(e) => run(() => updateIncident(workspace.id, incident.id, { assigneeId: e.target.value || null }))} className="w-full rounded-lg border px-2 py-1.5 text-xs focus:outline-none disabled:opacity-70" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name ?? 'Member'}</option>)}
              </select>
            </Field>
          </div>

          {incident.description && (
            <p className="mt-4 whitespace-pre-wrap rounded-lg border p-3 text-sm" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>{incident.description}</p>
          )}

          <div className="mt-5">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}><MessageSquare size={13} /> Comments</p>
            {comments === null ? (
              <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-3)' }}><Loader2 size={14} className="animate-spin" /> Loading…</p>
            ) : comments.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>No comments yet. Start the discussion below.</p>
            ) : (
              <div className="space-y-3">
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <Avatar name={c.author_name} url={memberAvatar(c.author_id)} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs"><span className="font-medium text-foreground">{c.author_name ?? 'Member'}</span> <span style={{ color: 'var(--text-3)' }}>{timeAgo(c.created_at)}</span></p>
                      <div className="mt-0.5 text-sm" style={{ color: 'var(--text)' }}><MentionText body={c.body} members={members} /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {canManage && (
          <div className="border-t px-5 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
            <MentionPicker members={members} onPick={insertMention} />
            <div className="mt-2 flex items-end gap-2">
              <textarea ref={textRef} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment… @ to tag" rows={2} maxLength={2000} className="flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
              <button type="button" onClick={send} disabled={busy || !body.trim()} className="flex h-9 w-9 items-center justify-center rounded-lg text-white transition disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              </button>
            </div>
          </div>
        )}

        {confirmDelete && (
          <ConfirmDialog
            title="Delete incident?"
            description="This removes the incident and all its comments."
            confirmLabel="Delete"
            tone="destructive"
            busy={busy}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={async () => { const res = await run(() => deleteIncident(workspace.id, incident.id)); if (res.ok) { setConfirmDelete(false); onClose() } }}
          />
        )}
      </div>
    </div>,
    document.body,
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{label}</label>
      {children}
    </div>
  )
}

function IncidentModal({
  busy, error, members, serverNames, onClose, onCreate,
}: {
  busy: boolean
  error: string | null
  members: { id: string; name: string }[]
  serverNames: Record<string, string>
  onClose: () => void
  onCreate: (input: { title: string; description?: string; severity?: string; assigneeId?: string | null; guildId?: string | null }) => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<Severity>('medium')
  const [assigneeId, setAssigneeId] = useState('')
  const [guildId, setGuildId] = useState('')

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <h2 className="font-semibold text-foreground">New incident</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground transition hover:text-foreground" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What happened?" maxLength={200} autoFocus className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details (optional)" rows={3} maxLength={4000} className="w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Severity</label>
              <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className="w-full rounded-lg border px-3 py-2 text-sm capitalize focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Server</label>
              <select value={guildId} onChange={(e) => setGuildId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                <option value="">Workspace</option>
                {Object.entries(serverNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Assignee</label>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground" style={{ borderColor: 'var(--line-strong)' }}>Cancel</button>
          <button type="button" disabled={busy || !title.trim()} onClick={() => onCreate({ title, description, severity, assigneeId: assigneeId || null, guildId: guildId || null })} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
            {busy && <Loader2 size={14} className="animate-spin" />}Open incident
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
