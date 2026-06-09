'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, Trophy, Settings } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { MembersDirectory } from '@/components/dashboard/members/MembersDirectory'
import { MembersLeaderboard } from '@/components/dashboard/members/MembersLeaderboard'

type Props = { guildId: string; guildName: string }
type Tab = 'directory' | 'leaderboard'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'directory', label: 'Directory', icon: <Users size={15} /> },
  { id: 'leaderboard', label: 'Leaderboard', icon: <Trophy size={15} /> },
]

export function MembersContent({ guildId, guildName }: Props) {
  const [tab, setTab] = useState<Tab>('directory')

  // Deep link (?tab=leaderboard) opens the leaderboard once on mount, then the
  // query is cleaned up so a refresh doesn't re-force it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('tab') === 'leaderboard') {
      setTab('leaderboard')
      params.delete('tab')
      const qs = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    }
  }, [])

  return (
    <div className="page-content">
      <PageHeader
        title="Members"
        helpId="members"
        description={
          <>
            Profiles, levels, reputation and activity for members of{' '}
            <span className="font-medium text-foreground">{guildName}</span>
          </>
        }
        action={
          <Link
            href={`/dashboard/${guildId}/leveling-settings`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <Settings size={12} />
            Level settings
          </Link>
        }
      />

      <div className="mb-6 inline-flex rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors"
              style={active ? { background: 'var(--p-soft)', color: 'var(--text)' } : { color: 'var(--text-2)' }}
            >
              <span style={active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{t.icon}</span>
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'directory' ? (
        <MembersDirectory guildId={guildId} />
      ) : (
        <MembersLeaderboard guildId={guildId} />
      )}
    </div>
  )
}
