'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Loader2, Upload, LogOut, Trash2, Crown, Building2, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { THEMES } from '@/lib/themes'
import { ROLE_LABELS } from '@/lib/workspace'
import { useWorkspace } from '@/components/workspace/WorkspaceProvider'
import { Sliders } from 'lucide-react'
import { useRunAction, FeedbackBanner } from '@/components/workspace/feedback'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CategorySection } from '@/components/ui/category-section'
import { updateWorkspace, leaveWorkspace, transferOwnership, deleteWorkspace } from '@/app/workspace/[workspaceId]/settings/actions'

const ACCENTS = THEMES.map((t) => t.accent)
const DEFAULT_ACCENT = THEMES[0].accent

export function WorkspaceSettings() {
  const { workspace, members, meId, isOwner, can } = useWorkspace()
  const router = useRouter()
  const { busy, feedback, setFeedback, run } = useRunAction()
  const canManage = can('manageWorkspace')

  const [name, setName] = useState(workspace.name)
  const [accent, setAccent] = useState(workspace.settings?.accent ?? ACCENTS[0])
  const [logoUrl, setLogoUrl] = useState<string | null>(workspace.logo_url)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [confirm, setConfirm] = useState<null | 'leave' | 'delete'>(null)
  const [transferTo, setTransferTo] = useState('')

  const otherMembers = members.filter((m) => m.user_id !== meId)

  async function onLogoFile(file: File) {
    setUploading(true)
    setFeedback(null)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
      const path = `${workspace.id}/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('workspace-logos').upload(path, file, { upsert: true, contentType: file.type })
      if (error) { setFeedback({ kind: 'error', text: 'Upload failed.' }); return }
      const { data } = supabase.storage.from('workspace-logos').getPublicUrl(path)
      setLogoUrl(data.publicUrl)
      await run(() => updateWorkspace(workspace.id, { logoUrl: data.publicUrl }), 'Logo updated.')
      router.refresh()
    } finally {
      setUploading(false)
    }
  }

  async function saveBranding() {
    const res = await run(() => updateWorkspace(workspace.id, { name, accent }), 'Settings saved.')
    if (res.ok) router.refresh()
  }

  // WorkspaceSettings is embedded directly into the Overview page — no
  // outer page-content wrapper, no PageHeader. The Overview owns the page
  // chrome; this component renders the branding + ownership + danger sections
  // inside a CategorySection so it sits alongside "At a glance" and
  // "Workspace" with the same visual rhythm.
  return (
    <CategorySection
      icon={<Sliders size={14} />}
      title="Settings"
      helpId="workspace-settings"
      description="Branding, ownership and danger zone."
    >
      <FeedbackBanner feedback={feedback} onClose={() => setFeedback(null)} />

      <div className="space-y-6">
        {canManage && (
          <section className="rounded-xl border" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <div className="border-b px-6 py-4" style={{ borderColor: 'var(--line-strong)' }}>
              <h2 className="font-semibold text-foreground">Branding</h2>
            </div>
            <div className="space-y-5 p-6">
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <Image src={logoUrl} alt={name} width={56} height={56} className="h-14 w-14 rounded-2xl object-cover" unoptimized />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>{name.charAt(0).toUpperCase()}</div>
                )}
                <div>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogoFile(f) }} />
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {logoUrl ? 'Change logo' : 'Upload logo'}
                  </button>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>PNG, JPG, WebP or GIF.</p>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Workspace name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="w-full max-w-sm rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
              </div>

              <div>
                {/* Accent picker — matches the server dashboard's Preferences > Accent
                    UI so the look stays consistent across the app. Workspace stores the
                    selected accent as a hex string; "Custom" is active when that hex
                    isn't one of the preset themes. */}
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">Accent Color</p>
                  <span
                    className="font-mono text-xs rounded px-1.5 py-0.5"
                    style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
                  >
                    {accent}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
                  {THEMES.map((t) => {
                    const active = accent === t.accent
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setAccent(t.accent)}
                        title={t.name}
                        className="group relative flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all duration-150"
                        style={{
                          background: active ? `${t.accent}14` : 'var(--bg-2)',
                          borderColor: active ? t.accent : 'var(--line-strong)',
                          boxShadow: active ? `0 0 0 1px ${t.accent}40` : 'none',
                        }}
                      >
                        <div
                          className="h-8 w-8 rounded-full"
                          style={{
                            background: `linear-gradient(135deg, ${t.accent}cc, ${t.accent})`,
                            boxShadow: active ? `0 4px 12px -4px ${t.accent}80` : `0 2px 6px -4px ${t.accent}60`,
                          }}
                        />
                        {active && (
                          <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: t.accent }}>
                            <Check size={9} strokeWidth={3} color="white" />
                          </span>
                        )}
                        <p className="text-xs font-medium text-foreground leading-none">{t.name}</p>
                      </button>
                    )
                  })}

                  {/* Custom — native color input behind a label, active when the
                      selected hex isn't one of the preset accents. */}
                  {(() => {
                    const customActive = !ACCENTS.includes(accent)
                    const display = customActive ? accent : DEFAULT_ACCENT
                    return (
                      <label
                        title="Custom color"
                        aria-label="Pick a custom accent color"
                        className="group relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all duration-150"
                        style={{
                          background: customActive ? `${display}14` : 'var(--bg-2)',
                          borderColor: customActive ? display : 'var(--line-strong)',
                          boxShadow: customActive ? `0 0 0 1px ${display}40` : 'none',
                        }}
                      >
                        <div
                          className="h-8 w-8 rounded-full"
                          style={{
                            background: customActive
                              ? `linear-gradient(135deg, ${display}cc, ${display})`
                              : 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #ec4899, #f43f5e)',
                            boxShadow: customActive
                              ? `0 4px 12px -4px ${display}80`
                              : '0 2px 6px -4px rgba(255,255,255,0.15)',
                          }}
                        />
                        {customActive && (
                          <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: display }}>
                            <Check size={9} strokeWidth={3} color="white" />
                          </span>
                        )}
                        <p className="text-xs font-medium text-foreground leading-none">Custom</p>
                        <input
                          type="color"
                          value={display}
                          onChange={(e) => setAccent(e.target.value)}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        />
                      </label>
                    )
                  })()}
                </div>
              </div>

              <button type="button" onClick={saveBranding} disabled={busy || !name.trim()} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
                {busy && <Loader2 size={14} className="animate-spin" />} Save settings
              </button>
            </div>
          </section>
        )}

        {/* Ownership transfer (owner only) */}
        {isOwner && otherMembers.length > 0 && (
          <section className="rounded-xl border" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <div className="border-b px-6 py-4" style={{ borderColor: 'var(--line-strong)' }}>
              <h2 className="flex items-center gap-2 font-semibold text-foreground"><Crown size={16} style={{ color: '#fbbf24' }} /> Transfer ownership</h2>
            </div>
            <div className="flex flex-wrap items-end gap-3 p-6">
              <div className="flex-1">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">New owner</label>
                <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className="w-full max-w-xs rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                  <option value="">Select a member…</option>
                  {otherMembers.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name ?? m.user_id} ({ROLE_LABELS[m.role]})</option>)}
                </select>
              </div>
              <button type="button" disabled={busy || !transferTo} onClick={async () => { const res = await run(() => transferOwnership(workspace.id, transferTo), 'Ownership transferred.'); if (res.ok) router.refresh() }} className="rounded-lg border px-4 py-2 text-sm font-medium transition disabled:opacity-50" style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                Transfer
              </button>
            </div>
          </section>
        )}

        {/* Danger zone */}
        <section className="rounded-xl border" style={{ background: 'var(--panel)', borderColor: 'rgba(239,68,68,0.35)' }}>
          <div className="border-b px-6 py-4" style={{ borderColor: 'rgba(239,68,68,0.2)' }}>
            <h2 className="font-semibold" style={{ color: '#f87171' }}>Danger zone</h2>
          </div>
          <div className="space-y-3 p-6">
            {!isOwner && (
              <Row icon={<LogOut size={16} />} title="Leave workspace" desc="You'll lose access to this workspace.">
                <button type="button" onClick={() => setConfirm('leave')} className="rounded-lg border px-3 py-1.5 text-sm font-medium transition" style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}>Leave</button>
              </Row>
            )}
            {isOwner && (
              <Row icon={<Trash2 size={16} />} title="Delete workspace" desc="Permanently deletes the workspace, team, notes, tasks and incidents. Discord servers and the bot are unaffected.">
                <button type="button" onClick={() => setConfirm('delete')} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition" style={{ background: '#dc2626' }}>Delete</button>
              </Row>
            )}
          </div>
        </section>

        {!canManage && !isOwner && (
          <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-3)' }}><Building2 size={15} /> Only admins can change workspace branding.</p>
        )}
      </div>

      {confirm === 'leave' && (
        <ConfirmDialog title="Leave workspace?" description="You'll need a new invite to rejoin." confirmLabel="Leave" tone="destructive" busy={busy} onCancel={() => setConfirm(null)} onConfirm={async () => { const res = await run(() => leaveWorkspace(workspace.id)); if (res.ok) { router.push('/workspace'); router.refresh() } }} />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog title={`Delete ${workspace.name}?`} description="This cannot be undone. All workspace data is permanently removed." confirmLabel="Delete workspace" tone="destructive" busy={busy} fields={[{ key: 'confirm', kind: 'text', label: `Type the workspace name to confirm`, placeholder: workspace.name, required: true }]} error={feedback?.kind === 'error' ? feedback.text : null} onCancel={() => setConfirm(null)} onConfirm={async (vals) => {
          if (vals.confirm !== workspace.name) { setFeedback({ kind: 'error', text: 'Name does not match.' }); return }
          const res = await run(() => deleteWorkspace(workspace.id)); if (res.ok) { router.push('/workspace'); router.refresh() }
        }} />
      )}
    </CategorySection>
  )
}

function Row({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground"><span style={{ color: '#f87171' }}>{icon}</span>{title}</p>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>{desc}</p>
      </div>
      {children}
    </div>
  )
}
