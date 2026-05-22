'use client'

import { useState } from 'react'
import { StickyNote, Trash2, Loader2, Plus, AlertCircle } from 'lucide-react'
import type { ModerationNote } from '@/lib/member-profile'
import { addMemberNote, deleteMemberNote } from '@/app/dashboard/[guildId]/members/actions'

type Props = {
  guildId: string
  userId: string
  /** Source of truth — owned by the profile, refreshed live via Realtime. */
  notes: ModerationNote[]
  /** Called after a successful add/delete so the profile refetches. */
  onChanged: () => void
}

const MAX_LENGTH = 1000

export function ModerationNotes({ guildId, userId, notes, onChanged }: Props) {
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd() {
    const body = draft.trim()
    if (!body || adding) return
    setAdding(true)
    setError(null)
    const result = await addMemberNote(guildId, userId, body)
    setAdding(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDraft('')
    onChanged()
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    setError(null)
    const result = await deleteMemberNote(guildId, id)
    setDeletingId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onChanged()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a private note for the moderation team…"
          maxLength={MAX_LENGTH}
          rows={2}
          className="w-full resize-none bg-transparent text-sm focus:outline-none"
          style={{ color: 'var(--text)' }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-subtle">{draft.length}/{MAX_LENGTH} · Only visible to moderators</span>
          <button
            onClick={handleAdd}
            disabled={adding || draft.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50"
            style={{ borderColor: 'color-mix(in srgb, var(--p-1) 30%, transparent)', background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Add note
          </button>
        </div>
      </div>

      {error && (
        <div
          className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
        >
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notes.length === 0 ? (
        <div className="flex items-center gap-2 py-2 text-sm text-subtle">
          <StickyNote size={14} />
          No notes yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="group flex items-start gap-3 rounded-lg border p-3"
              style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}
            >
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{note.body}</p>
                <p className="mt-1.5 text-xs text-subtle">
                  {note.author_username ?? 'Moderator'} · {new Date(note.created_at).toLocaleString('en-US')}
                </p>
              </div>
              <button
                onClick={() => handleDelete(note.id)}
                disabled={deletingId === note.id}
                className="shrink-0 rounded p-1 text-subtle opacity-0 transition hover:text-[#f87171] group-hover:opacity-100 disabled:opacity-50"
                aria-label="Delete note"
                title="Delete note"
              >
                {deletingId === note.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
