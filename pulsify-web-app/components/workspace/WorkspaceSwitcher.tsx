'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ChevronsUpDown, Check, Plus, Building2 } from 'lucide-react'
import type { Workspace, WorkspaceSummary } from '@/lib/workspace'

function Logo({ name, url, size = 28 }: { name: string; url: string | null; size?: number }) {
  if (url) {
    return <Image src={url} alt={name} width={size} height={size} className="rounded-lg object-cover" style={{ width: size, height: size }} unoptimized />
  }
  return (
    <div
      className="flex items-center justify-center rounded-lg font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

export function WorkspaceSwitcher({
  current,
  workspaces,
  collapsed,
}: {
  current: Workspace
  workspaces: WorkspaceSummary[]
  collapsed?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={collapsed ? current.name : undefined}
        className="flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 transition"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', justifyContent: collapsed ? 'center' : 'space-between' }}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Logo name={current.name} url={current.logo_url} />
          {!collapsed && <span className="truncate text-sm font-semibold text-foreground">{current.name}</span>}
        </span>
        {!collapsed && <ChevronsUpDown size={14} style={{ color: 'var(--text-3)' }} />}
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border shadow-2xl"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', minWidth: 220 }}
        >
          <div className="max-h-72 overflow-y-auto p-1.5">
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Workspaces</p>
            {workspaces.map((w) => (
              <Link
                key={w.id}
                href={`/workspace/${w.id}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-[var(--bg-2)]"
              >
                <Logo name={w.name} url={w.logo_url} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{w.name}</span>
                {w.id === current.id && <Check size={14} style={{ color: 'var(--p-1)' }} />}
              </Link>
            ))}
          </div>
          <div className="border-t p-1.5" style={{ borderColor: 'var(--line-strong)' }}>
            <Link href="/workspace" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-[var(--bg-2)] hover:text-foreground">
              <Building2 size={15} /> All workspaces
            </Link>
            <Link href="/workspace?new=1" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-[var(--bg-2)] hover:text-foreground">
              <Plus size={15} /> New workspace
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
