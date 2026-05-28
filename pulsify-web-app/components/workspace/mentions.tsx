'use client'

import { useMemo } from 'react'
import { AtSign } from 'lucide-react'
import { mentionMatches, type WorkspaceMember } from '@/lib/workspace'

type MentionMember = Pick<WorkspaceMember, 'user_id' | 'display_name'>

/**
 * Render a note/comment body with @mentions of workspace members highlighted.
 * Single-token mentions (no spaces) are matched against member display names —
 * the same rule lib/workspace.ts parseMentions uses on the server.
 */
export function MentionText({ body, members }: { body: string; members: MentionMember[] }) {
  const segments = useMemo(() => {
    const parts: { text: string; mention: boolean }[] = []
    const re = /@[a-z0-9_.\-]{1,32}/gi
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(body)) !== null) {
      const token = m[0]
      const isMention = members.some((mem) => mentionMatches(token.slice(1), mem.display_name))
      if (m.index > last) parts.push({ text: body.slice(last, m.index), mention: false })
      parts.push({ text: token, mention: isMention })
      last = m.index + token.length
    }
    if (last < body.length) parts.push({ text: body.slice(last), mention: false })
    return parts
  }, [body, members])

  return (
    <span className="whitespace-pre-wrap break-words">
      {segments.map((s, i) =>
        s.mention ? (
          <span key={i} className="rounded px-1 font-medium" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>{s.text}</span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  )
}

/**
 * A row of member chips that insert "@Name " into a text field. A lightweight
 * stand-in for full caret-tracking autocomplete — click to tag a teammate.
 */
export function MentionPicker({ members, onPick }: { members: MentionMember[]; onPick: (name: string) => void }) {
  if (members.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--text-3)' }}><AtSign size={12} /> Tag</span>
      {members.slice(0, 12).map((m) => (
        <button
          key={m.user_id}
          type="button"
          onClick={() => onPick((m.display_name ?? '').split(/\s+/)[0])}
          className="rounded-full border px-2 py-0.5 text-xs font-medium transition hover:border-[var(--p-1)]"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
        >
          {m.display_name ?? 'member'}
        </button>
      ))}
    </div>
  )
}
