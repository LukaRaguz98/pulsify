'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { X, Loader2, Users, Search } from 'lucide-react'
import { avatarUrl, type EventUser } from '@/lib/discord'

type Props = {
  guildId: string
  eventId: string
  eventName: string
  onClose: () => void
}

export function ParticipantsModal({ guildId, eventId, eventName, onClose }: Props) {
  const [users, setUsers] = useState<EventUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(`/api/discord/guild/${guildId}/events/${eventId}/users`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(data.error ?? `Failed to load participants (${res.status})`)
        }
        return res.json() as Promise<EventUser[]>
      })
      .then((data) => { if (active) setUsers(data) })
      .catch((e: Error) => { if (active) setError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [guildId, eventId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const q = search.trim().toLowerCase()
  const filtered = q
    ? users.filter((u) =>
        (u.user.global_name ?? '').toLowerCase().includes(q) ||
        u.user.username.toLowerCase().includes(q))
    : users

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col rounded-xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', maxHeight: '80vh' }}
      >
        <header className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div className="flex min-w-0 items-center gap-2">
            <Users size={16} style={{ color: 'var(--p-1)' }} />
            <h2 className="truncate font-semibold text-foreground">
              Interested in &ldquo;{eventName}&rdquo;
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="border-b px-5 py-3" style={{ borderColor: 'var(--line-strong)' }}>
          <div className="relative">
            <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter participants…"
              className="w-full rounded-lg border py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-1"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="px-5 py-8 text-center text-sm text-[#f87171]">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-subtle">
              {q ? 'No participants match this filter.' : 'No one has marked this event as interesting yet.'}
            </p>
          ) : (
            <ul>
              {filtered.map((u) => {
                const av = avatarUrl(u.user.id, u.user.avatar)
                const name = u.user.global_name ?? u.user.username
                const hasDisplay = !!u.user.global_name && u.user.global_name !== u.user.username
                return (
                  <li
                    key={u.user.id}
                    className="flex items-center gap-3 border-b px-5 py-2.5 last:border-b-0"
                    style={{ borderColor: 'var(--line-strong)' }}
                  >
                    <Image src={av} alt={name} width={28} height={28} className="rounded-full shrink-0" unoptimized />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{name}</p>
                      {hasDisplay && (
                        <p className="truncate text-xs text-subtle">{u.user.username}</p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className="border-t px-5 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          <p className="text-xs text-subtle">
            Showing {filtered.length}{q && filtered.length !== users.length ? ` of ${users.length}` : ''} participants
            {users.length === 100 && ' (Discord caps at 100)'}.
          </p>
        </footer>
      </div>
    </div>
  )
}
