'use client'

import { useRef, useState } from 'react'
import { Pin, PinOff, Trash2, Pencil, StickyNote, Send, Loader2, TrendingUp } from 'lucide-react'
import { timeAgo, type WorkspaceNote } from '@/lib/workspace'
import { useWorkspace } from '@/components/workspace/WorkspaceProvider'
import { useRealtimeRows } from '@/components/workspace/use-realtime'
import { useRunAction, FeedbackBanner, Avatar } from '@/components/workspace/feedback'
import { MentionText, MentionPicker } from '@/components/workspace/mentions'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { createNote, updateNote, deleteNote, togglePinNote } from '@/app/workspace/[workspaceId]/notes/actions'

export function NotesContent({ initialNotes, serverNames }: { initialNotes: WorkspaceNote[]; serverNames: Record<string, string> }) {
  const { workspace, members, can } = useWorkspace()
  const { rows: notes } = useRealtimeRows<WorkspaceNote>('workspace_notes', workspace.id, initialNotes)
  const { busy, feedback, setFeedback, run } = useRunAction()
  const canManage = can('manageNotes')

  const [body, setBody] = useState('')
  const [guildId, setGuildId] = useState('')
  const [editing, setEditing] = useState<WorkspaceNote | null>(null)
  const [deleting, setDeleting] = useState<WorkspaceNote | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const sorted = [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || +new Date(b.created_at) - +new Date(a.created_at))
  const memberAvatar = (id: string | null) => members.find((m) => m.user_id === id)?.avatar_url ?? null

  const pinnedCount = notes.filter((n) => n.pinned).length
  const workspaceCount = notes.filter((n) => !n.guild_id).length
  const serverCount = notes.filter((n) => n.guild_id).length

  const stats = [
    { label: 'Notes', value: notes.length, icon: <StickyNote size={16} /> },
    { label: 'Pinned', value: pinnedCount, icon: <Pin size={16} /> },
    { label: 'Workspace-wide', value: workspaceCount, icon: <StickyNote size={16} /> },
    { label: 'Server-scoped', value: serverCount, icon: <StickyNote size={16} /> },
  ]

  function insertMention(name: string) {
    setBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}@${name} `)
    textRef.current?.focus()
  }

  async function post() {
    if (!body.trim()) return
    const res = await run(() => createNote(workspace.id, { body, guildId: guildId || null }), 'Note posted.')
    if (res.ok) setBody('')
  }

  return (
    <div className="page-content">
      <PageHeader title="Notes" description="Shared staff and moderation notes. Tag teammates with @ to keep everyone in the loop." />
      <FeedbackBanner feedback={feedback} onClose={() => setFeedback(null)} />

      <div className="space-y-8">
      <CategorySection
        icon={<TrendingUp size={14} />}
        title="At a glance"
        description="Snapshot of the team's shared notes."
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
        icon={<StickyNote size={14} />}
        title="Shared notes"
        description="Post new notes, pin the important ones, and tag teammates with @ to keep everyone in the loop."
      >
      {canManage && (
        <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <textarea
            ref={textRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a note for the team… use @name to tag someone"
            rows={3}
            maxLength={4000}
            className="w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <MentionPicker members={members} onPick={insertMention} />
            <div className="flex items-center gap-2">
              <select value={guildId} onChange={(e) => setGuildId(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
                <option value="">Whole workspace</option>
                {Object.entries(serverNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <button type="button" onClick={post} disabled={busy || !body.trim()} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Post
              </button>
            </div>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState icon={<StickyNote size={30} />} title="No notes yet" description={canManage ? 'Post the first note to start a shared record.' : 'Notes your team posts will appear here.'} />
      ) : (
        <div className="space-y-3">
          {sorted.map((n) => (
            <div key={n.id} className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: n.pinned ? 'var(--p-1)' : 'var(--line-strong)' }}>
              <div className="flex items-start gap-3">
                <Avatar name={n.author_name} url={memberAvatar(n.author_id)} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{n.author_name ?? 'Member'}</span>
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>{timeAgo(n.created_at)}</span>
                    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>{n.guild_id ? (serverNames[n.guild_id] ?? 'Server') : 'Workspace'}</span>
                    {n.subject_user_id && <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'rgba(251,146,60,0.12)', color: '#fb923c' }}>about user {n.subject_user_id}</span>}
                    {n.pinned && <Pin size={12} style={{ color: 'var(--p-1)' }} />}
                  </div>
                  <div className="mt-1.5 text-sm" style={{ color: 'var(--text)' }}>
                    <MentionText body={n.body} members={members} />
                  </div>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button type="button" onClick={() => run(() => togglePinNote(workspace.id, n.id, !n.pinned))} title={n.pinned ? 'Unpin' : 'Pin'} className="rounded-md p-1.5 transition hover:bg-[var(--bg-2)]" style={{ color: n.pinned ? 'var(--p-1)' : 'var(--text-3)' }}>
                      {n.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                    <button type="button" onClick={() => setEditing(n)} title="Edit" className="rounded-md p-1.5 transition hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-3)' }}><Pencil size={14} /></button>
                    <button type="button" onClick={() => setDeleting(n)} title="Delete" className="rounded-md p-1.5 transition hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-3)' }}><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </CategorySection>
      </div>

      {editing && (
        <ConfirmDialog
          title="Edit note"
          confirmLabel="Save"
          fields={[{ key: 'body', kind: 'textarea', label: 'Note', defaultValue: editing.body, required: true, maxLength: 4000 }]}
          busy={busy}
          error={feedback?.kind === 'error' ? feedback.text : null}
          onCancel={() => setEditing(null)}
          onConfirm={async (vals) => {
            const res = await run(() => updateNote(workspace.id, editing.id, { body: vals.body }), 'Note updated.')
            if (res.ok) setEditing(null)
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete note?"
          description="This permanently removes the note for everyone."
          confirmLabel="Delete"
          tone="destructive"
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const res = await run(() => deleteNote(workspace.id, deleting.id), 'Note deleted.')
            if (res.ok) setDeleting(null)
          }}
        />
      )}
    </div>
  )
}
