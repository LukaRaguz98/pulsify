'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Plus, Building2, Users, Server } from 'lucide-react'
import { ROLE_BADGE, ROLE_LABELS, type WorkspaceSummary } from '@/lib/workspace'
import { CreateWorkspaceWizard } from '@/components/workspace/CreateWorkspaceWizard'

export type PickableGuild = {
  id: string
  name: string
  icon: string | null
  botInstalled: boolean
}

export function WorkspacePicker({
  workspaces,
  guilds,
}: {
  workspaces: WorkspaceSummary[]
  guilds: PickableGuild[]
}) {
  const [creating, setCreating] = useState(false)

  if (workspaces.length === 0) {
    return (
      <>
        <div
          className="flex flex-col items-center justify-center rounded-2xl border py-20 text-center"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <div
            className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            <Building2 size={26} />
          </div>
          <p className="text-lg font-semibold text-foreground">Create your first workspace</p>
          <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
            Bring your servers and team into one place — shared notes, tasks, incidents and a
            cross-server overview.
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-6 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))', boxShadow: '0 6px 20px var(--p-glow)' }}
          >
            <Plus size={16} /> New workspace
          </button>
        </div>
        {creating && <CreateWorkspaceWizard guilds={guilds} onClose={() => setCreating(false)} />}
      </>
    )
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {workspaces.map((w) => {
          const badge = ROLE_BADGE[w.role]
          return (
            <Link
              key={w.id}
              href={`/workspace/${w.id}`}
              className="group rounded-2xl border p-5 transition"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
            >
              <div className="flex items-center gap-3">
                {w.logo_url ? (
                  <Image src={w.logo_url} alt={w.name} width={44} height={44} className="h-11 w-11 rounded-xl object-cover" unoptimized />
                ) : (
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
                  >
                    {w.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{w.name}</p>
                  <span
                    className="mt-1 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}
                  >
                    {ROLE_LABELS[w.role]}
                  </span>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-4 text-xs" style={{ color: 'var(--text-3)' }}>
                <span className="inline-flex items-center gap-1.5"><Server size={13} /> {w.server_count} server{w.server_count === 1 ? '' : 's'}</span>
                <span className="inline-flex items-center gap-1.5"><Users size={13} /> {w.member_count} member{w.member_count === 1 ? '' : 's'}</span>
              </div>
            </Link>
          )
        })}

        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-sm font-medium transition"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
        >
          <Plus size={20} />
          New workspace
        </button>
      </div>

      {creating && <CreateWorkspaceWizard guilds={guilds} onClose={() => setCreating(false)} />}
    </>
  )
}
