'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, ListChecks, Trash2, Pencil, Calendar, X, Loader2, TrendingUp, AlertTriangle } from 'lucide-react'
import {
  TASK_STATUSES, TASK_STATUS_LABELS, PRIORITIES, timeAgo,
  type Priority, type TaskStatus, type WorkspaceTask,
} from '@/lib/workspace'
import { useWorkspace } from '@/components/workspace/WorkspaceProvider'
import { useRealtimeRows } from '@/components/workspace/use-realtime'
import { useRunAction, FeedbackBanner, Avatar } from '@/components/workspace/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { createTask, updateTask, updateTaskStatus, deleteTask } from '@/app/workspace/[workspaceId]/tasks/actions'

const PRIORITY_COLOR: Record<Priority, string> = { low: '#94a3b8', normal: '#60a5fa', high: '#fb923c', urgent: '#f87171' }
const COLUMN_ACCENT: Record<TaskStatus, string> = { open: '#94a3b8', in_progress: '#60a5fa', done: '#34d399' }

export function TasksContent({ initialTasks }: { initialTasks: WorkspaceTask[] }) {
  const { workspace, members, can } = useWorkspace()
  const { rows: tasks } = useRealtimeRows<WorkspaceTask>('workspace_tasks', workspace.id, initialTasks)
  const { busy, feedback, setFeedback, run } = useRunAction()
  const canManage = can('manageTasks')

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<WorkspaceTask | null>(null)
  const [deleting, setDeleting] = useState<WorkspaceTask | null>(null)

  const memberName = (id: string | null) => members.find((m) => m.user_id === id)?.display_name ?? null
  const memberAvatar = (id: string | null) => members.find((m) => m.user_id === id)?.avatar_url ?? null

  const openCount = tasks.filter((t) => t.status === 'open').length
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length
  const doneCount = tasks.filter((t) => t.status === 'done').length
  const urgentOpen = tasks.filter((t) => t.priority === 'urgent' && t.status !== 'done').length

  const stats = [
    { label: 'Tasks', value: tasks.length, icon: <ListChecks size={16} /> },
    { label: 'Open', value: openCount, icon: <ListChecks size={16} /> },
    { label: 'In progress', value: inProgressCount, icon: <ListChecks size={16} /> },
    { label: 'Urgent open', value: urgentOpen, icon: <AlertTriangle size={16} /> },
  ]

  return (
    <div className="page-content">
      <PageHeader
        title="Tasks"
        description="A shared to-do board for your team across all servers."
        action={canManage ? (
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
            <Plus size={15} /> New task
          </button>
        ) : undefined}
      />
      <FeedbackBanner feedback={feedback} onClose={() => setFeedback(null)} />

      <div className="space-y-8">
      <CategorySection
        icon={<TrendingUp size={14} />}
        title="At a glance"
        description="Snapshot of work in flight across the workspace."
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
        icon={<ListChecks size={14} />}
        title="Task board"
        description="Open, In progress and Done columns — track progress at a glance."
      >
      {tasks.length === 0 ? (
        <EmptyTasks canManage={canManage} onCreate={() => setCreating(true)} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {TASK_STATUSES.map((status) => {
            const col = tasks.filter((t) => t.status === status)
            return (
              <div key={status} className="rounded-xl border" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
                <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: 'var(--line-strong)' }}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: COLUMN_ACCENT[status] }} />
                    {TASK_STATUS_LABELS[status]}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>{col.length}</span>
                </div>
                <div className="space-y-2 p-3">
                  {col.length === 0 ? (
                    <p className="px-1 py-4 text-center text-xs" style={{ color: 'var(--text-3)' }}>Nothing here.</p>
                  ) : col.map((t) => (
                    <div key={t.id} className="rounded-lg border p-3" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                      <div className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: PRIORITY_COLOR[t.priority] }} title={t.priority} />
                        <p className="min-w-0 flex-1 text-sm font-medium text-foreground">{t.title}</p>
                        {canManage && (
                          <div className="flex shrink-0 gap-0.5">
                            <button type="button" onClick={() => setEditing(t)} title="Edit" className="rounded p-1 transition hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-3)' }}><Pencil size={13} /></button>
                            <button type="button" onClick={() => setDeleting(t)} title="Delete" className="rounded p-1 transition hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-3)' }}><Trash2 size={13} /></button>
                          </div>
                        )}
                      </div>
                      {t.description && <p className="mt-1.5 line-clamp-2 text-xs" style={{ color: 'var(--text-3)' }}>{t.description}</p>}
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
                          {t.assignee_id ? (
                            <span className="flex items-center gap-1"><Avatar name={memberName(t.assignee_id)} url={memberAvatar(t.assignee_id)} size={16} />{memberName(t.assignee_id) ?? 'Assigned'}</span>
                          ) : <span>Unassigned</span>}
                          {t.due_at && <span className="inline-flex items-center gap-0.5"><Calendar size={11} /> {timeAgo(t.due_at)}</span>}
                        </div>
                        {canManage && (
                          <select
                            value={t.status}
                            disabled={busy}
                            onChange={(e) => run(() => updateTaskStatus(workspace.id, t.id, e.target.value))}
                            className="rounded border px-1.5 py-0.5 text-[11px] focus:outline-none"
                            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                          >
                            {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
                          </select>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      </CategorySection>
      </div>

      {(creating || editing) && (
        <TaskModal
          task={editing}
          busy={busy}
          error={feedback?.kind === 'error' ? feedback.text : null}
          members={members.map((m) => ({ id: m.user_id, name: m.display_name ?? 'Member' }))}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSave={async (input) => {
            const res = editing
              ? await run(() => updateTask(workspace.id, editing.id, input), 'Task updated.')
              : await run(() => createTask(workspace.id, input), 'Task created.')
            if (res.ok) { setCreating(false); setEditing(null) }
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete task?"
          description="This removes the task for everyone."
          confirmLabel="Delete"
          tone="destructive"
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => { const res = await run(() => deleteTask(workspace.id, deleting.id), 'Task deleted.'); if (res.ok) setDeleting(null) }}
        />
      )}
    </div>
  )
}

function EmptyTasks({ canManage, onCreate }: { canManage: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border py-16 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-3" style={{ color: 'var(--text-3)' }}><ListChecks size={30} /></div>
      <p className="font-semibold text-foreground">No tasks yet</p>
      <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>{canManage ? 'Create a task to track work across your servers.' : 'Tasks your team creates will appear here.'}</p>
      {canManage && <button type="button" onClick={onCreate} className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>New task</button>}
    </div>
  )
}

function TaskModal({
  task, busy, error, members, onClose, onSave,
}: {
  task: WorkspaceTask | null
  busy: boolean
  error: string | null
  members: { id: string; name: string }[]
  onClose: () => void
  onSave: (input: { title: string; description?: string; priority?: string; assigneeId?: string | null; dueAt?: string | null }) => void
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'normal')
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? '')
  const [due, setDue] = useState(task?.due_at ? task.due_at.slice(0, 10) : '')

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <h2 className="font-semibold text-foreground">{task ? 'Edit task' : 'New task'}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground transition hover:text-foreground" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" maxLength={200} autoFocus className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details (optional)" rows={3} maxLength={2000} className="w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Due date</label>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
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
          <button
            type="button"
            disabled={busy || !title.trim()}
            onClick={() => onSave({ title, description, priority, assigneeId: assigneeId || null, dueAt: due ? new Date(due).toISOString() : null })}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}{task ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
