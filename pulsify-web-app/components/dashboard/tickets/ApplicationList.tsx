'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { Search, User } from 'lucide-react'
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_META,
  applicationTypeDisplay,
  applicantAvatarUrl,
  timeAgo,
  type Application,
  type ApplicationStatus,
} from '@/lib/applications'
import { ApplicationStatusBadge } from './badges'

type Props = {
  applications: Application[]
  onSelect: (id: string) => void
}

type StatusFilter = ApplicationStatus | 'all' | 'open'

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

export function ApplicationList({ applications, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('open')
  const [typeId, setTypeId] = useState<string>('all')

  const typeOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const a of applications) {
      const id = a.type_id ?? 'other'
      seen.set(id, applicationTypeDisplay(a))
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }))
  }, [applications])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return applications.filter((a) => {
      if (status === 'open' && !(a.status === 'pending' || a.status === 'needs_info')) return false
      if (status !== 'all' && status !== 'open' && a.status !== status) return false
      if (typeId !== 'all' && (a.type_id ?? 'other') !== typeId) return false
      if (q) {
        const hay = `#${a.number} ${applicationTypeDisplay(a)} ${a.applicant_name ?? ''} ${a.message ?? ''} ${a.reviewer_name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [applications, query, status, typeId])

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search applicants, types, details…"
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
            style={selectStyle}
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={selectStyle}>
          <option value="open">Needs review</option>
          <option value="all">All statuses</option>
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>{APPLICATION_STATUS_META[s].label}</option>
          ))}
        </select>
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={selectStyle}>
          <option value="all">All types</option>
          {typeOptions.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div
          className="rounded-xl border py-12 text-center text-sm"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
        >
          No applications match these filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          {filtered.map((a, i) => {
            const avatar = applicantAvatarUrl(a.applicant_id, a.applicant_avatar)
            return (
              <button
                key={a.id}
                onClick={() => onSelect(a.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line-strong)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '')}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold"
                  style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                >
                  {avatar ? (
                    <Image src={avatar} alt="" width={36} height={36} className="h-full w-full object-cover" unoptimized />
                  ) : (
                    <User size={15} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {a.applicant_name ?? 'A member'}
                    </span>
                    <span
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                      style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                    >
                      {applicationTypeDisplay(a)}
                    </span>
                  </div>
                  <p className="truncate text-xs" style={{ color: 'var(--text-3)' }}>
                    #{a.number} · {timeAgo(a.created_at)}
                    {a.reviewer_name ? ` · reviewer ${a.reviewer_name}` : ''}
                    {a.message ? ` · ${a.message.replace(/\s+/g, ' ')}` : ''}
                  </p>
                </div>
                <ApplicationStatusBadge status={a.status} />
              </button>
            )
          })}
        </div>
      )}
      <p className="mt-3 text-xs" style={{ color: 'var(--text-3)' }}>
        Showing {filtered.length} of {applications.length} application{applications.length === 1 ? '' : 's'}.
      </p>
    </div>
  )
}
