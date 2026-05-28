'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { X, Loader2, Check, ArrowRight, ArrowLeft, Building2 } from 'lucide-react'
import { guildIconUrl } from '@/lib/discord'
import { THEMES } from '@/lib/themes'
import { createWorkspace } from '@/app/workspace/actions'
import type { PickableGuild } from '@/components/workspace/WorkspacePicker'

const ACCENTS = THEMES.map((t) => ({ key: t.id, color: t.accent }))

export function CreateWorkspaceWizard({
  guilds,
  onClose,
}: {
  guilds: PickableGuild[]
  onClose: () => void
}) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [accent, setAccent] = useState(ACCENTS[0]?.color ?? '#8b5cf6')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const installable = guilds.filter((g) => g.botInstalled)

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await createWorkspace({ name: name.trim(), accent, guildIds: [...picked] })
    if (res.ok) {
      router.push(`/workspace/${res.data.id}`)
      router.refresh()
    } else {
      setError(res.error)
      setBusy(false)
    }
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create workspace"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
              <Building2 size={16} />
            </span>
            <div>
              <h2 className="font-semibold text-foreground">New workspace</h2>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>Step {step} of 2</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {step === 1 ? (
          <div className="space-y-5 px-5 py-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Workspace name <span className="text-[#f87171]">*</span></label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Communities"
                maxLength={60}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-muted-foreground">Accent</label>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => setAccent(a.color)}
                    className="h-8 w-8 rounded-full transition"
                    style={{ background: a.color, outline: accent === a.color ? '2px solid var(--text)' : 'none', outlineOffset: 2 }}
                    aria-label={a.key}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-5 py-5">
            <p className="mb-3 text-sm" style={{ color: 'var(--text-2)' }}>
              Add servers to manage in this workspace. You can change this later.
            </p>
            {installable.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
                None of your servers have Pulse installed yet. Create the workspace now and add servers once the bot is in them.
              </div>
            ) : (
              <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {installable.map((g) => {
                  const on = picked.has(g.id)
                  const icon = guildIconUrl(g.id, g.icon, 48)
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggle(g.id)}
                      className="flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition"
                      style={{ background: on ? 'var(--p-soft)' : 'var(--bg-2)', borderColor: on ? 'var(--p-1)' : 'var(--line-strong)' }}
                    >
                      {icon ? (
                        <Image src={icon} alt={g.name} width={28} height={28} className="h-7 w-7 rounded-lg" unoptimized />
                      ) : (
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>{g.name.charAt(0)}</div>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{g.name}</span>
                      <span className="flex h-5 w-5 items-center justify-center rounded-md border" style={{ borderColor: on ? 'var(--p-1)' : 'var(--line-strong)', background: on ? 'var(--p-1)' : 'transparent' }}>
                        {on && <Check size={12} className="text-white" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mx-5 mb-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          {step === 2 ? (
            <button type="button" onClick={() => setStep(1)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50" style={{ borderColor: 'var(--line-strong)' }}>
              <ArrowLeft size={14} /> Back
            </button>
          ) : <span />}
          {step === 1 ? (
            <button
              type="button"
              onClick={() => name.trim() && setStep(2)}
              disabled={!name.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
            >
              Next <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? 'Creating…' : picked.size > 0 ? `Create with ${picked.size} server${picked.size === 1 ? '' : 's'}` : 'Create workspace'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
