'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  LayoutTemplate,
  Plus,
  Upload,
  Search,
  Library,
  Star,
  Boxes,
  Repeat2,
  Layers,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { createClient as createSupabase } from '@/lib/supabase'
import {
  BUILTIN_TEMPLATES,
  CATEGORY_META,
  TEMPLATE_CATEGORIES,
  sectionKeysPresent,
  toExport,
  type ServerTemplate,
  type TemplateCategory,
  type TemplateSectionKey,
} from '@/lib/templates'
import type { GuildConfigSnapshot } from '@/app/dashboard/[guildId]/templates/page'
import { deleteTemplate } from '@/app/dashboard/[guildId]/templates/actions'
import { TemplateCard } from './TemplateCard'
import { TemplateCreatePanel } from './TemplateCreatePanel'
import { TemplateApplyWizard } from './TemplateApplyWizard'
import { TemplateImportPanel } from './TemplateImportPanel'
import { TemplateEditPanel } from './TemplateEditPanel'

type Props = {
  guildId: string
  guildName: string
  savedTemplates: ServerTemplate[]
  snapshot: GuildConfigSnapshot
  capturableSections: TemplateSectionKey[]
}

type Tab = 'library' | 'presets'

export function TemplatesContent({ guildId, guildName, savedTemplates, snapshot, capturableSections }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(savedTemplates.length === 0 ? 'presets' : 'library')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'all' | TemplateCategory>('all')
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [applying, setApplying] = useState<ServerTemplate | null>(null)
  const [editing, setEditing] = useState<ServerTemplate | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ServerTemplate | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Quick-action deep links: ?new=1 / ?import=1.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    let changed = false
    if (params.get('new') === '1') {
      setCreating(true)
      params.delete('new')
      changed = true
    }
    if (params.get('import') === '1') {
      setImporting(true)
      params.delete('import')
      changed = true
    }
    if (changed) {
      const qs = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    }
  }, [])

  // Realtime: refresh the library as templates are created/applied/deleted.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const supabase = createSupabase()
    const schedule = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => startTransition(() => router.refresh()), 800)
    }
    const channel = supabase
      .channel(`server_templates:${guildId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'server_templates' }, schedule)
      .subscribe()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [guildId, router])

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router])

  const source = tab === 'library' ? savedTemplates : BUILTIN_TEMPLATES

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return source.filter((t) => {
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false
      if (!q) return true
      return t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)
    })
  }, [source, search, categoryFilter])

  const totalUses = useMemo(() => savedTemplates.reduce((sum, t) => sum + t.usageCount, 0), [savedTemplates])
  const sectionsCovered = useMemo(() => {
    const s = new Set<TemplateSectionKey>()
    for (const t of savedTemplates) for (const k of sectionKeysPresent(t.sections)) s.add(k)
    return s.size
  }, [savedTemplates])

  // Categories present in the active tab (for the filter chips).
  const usedCategories = useMemo(
    () => TEMPLATE_CATEGORIES.filter((c) => source.some((t) => t.category === c)),
    [source],
  )

  function onExport(t: ServerTemplate) {
    const blob = new Blob([JSON.stringify(toExport(t), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${t.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'template'}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function onConfirmDelete() {
    if (!deleteTarget) return
    setDeletingId(deleteTarget.id)
    await deleteTemplate(guildId, deleteTarget.id)
    setDeletingId(null)
    setDeleteTarget(null)
    refresh()
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Templates"
        helpId="templates"
        description={
          <>
            Save, reuse and deploy proven configurations across your servers —{' '}
            <span className="font-medium text-foreground">{guildName}</span> and beyond
          </>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton onClick={refresh} refreshing={pending} />
            <button
              onClick={() => setImporting(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <Upload size={15} /> Import
            </button>
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
            >
              <Plus size={15} /> Save as template
            </button>
          </div>
        }
      />

      <div className="space-y-8">
        {/* At a glance */}
        <CategorySection icon={<LayoutTemplate size={14} />} title="At a glance" description="Your reusable server configurations.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Library size={16} />} label="Saved templates" value={savedTemplates.length} color="#60a5fa" />
            <StatCard icon={<Star size={16} />} label="Official presets" value={BUILTIN_TEMPLATES.length} color="#8b5cf6" />
            <StatCard icon={<Layers size={16} />} label="Sections covered" value={sectionsCovered} color="#34d399" />
            <StatCard icon={<Repeat2 size={16} />} label="Total deployments" value={totalUses} color="#f59e0b" />
          </div>
        </CategorySection>

        <CategorySection icon={<Boxes size={14} />} title="Browse" description="Apply a template to this server or manage your library.">
          {/* Tabs + filters */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="max-w-full overflow-x-auto">
            <div className="inline-flex rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              {([
                { id: 'library' as Tab, label: 'My library', icon: <Library size={15} />, count: savedTemplates.length },
                { id: 'presets' as Tab, label: 'Official presets', icon: <Star size={15} />, count: BUILTIN_TEMPLATES.length },
              ]).map((t) => {
                const active = tab === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors"
                    style={active ? { background: 'var(--p-soft)', color: 'var(--text)', boxShadow: 'inset 0 0 0 1px var(--p-soft)' } : { color: 'var(--text-2)' }}
                  >
                    <span style={active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{t.icon}</span>
                    {t.label}
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>{t.count}</span>
                  </button>
                )
              })}
            </div>
            </div>
          </div>

          {/* Search + category filter */}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates…"
                className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </div>
            {usedCategories.length > 0 && (
              <div className="inline-flex flex-wrap rounded-lg border p-0.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
                {(['all', ...usedCategories] as const).map((f) => {
                  const active = categoryFilter === f
                  const label = f === 'all' ? 'All' : CATEGORY_META[f].label
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setCategoryFilter(f)}
                      className="rounded-md px-3 py-1 text-xs font-medium transition"
                      style={{ background: active ? 'var(--p-soft)' : 'transparent', color: active ? 'var(--p-1)' : 'var(--text-3)' }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Grid / empty states */}
          <div className="mt-5">
            {source.length === 0 ? (
              <EmptyLibrary onCreate={() => setCreating(true)} onBrowse={() => setTab('presets')} />
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border py-14 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
                  <Search size={22} />
                </div>
                <p className="font-semibold text-foreground">No matching templates</p>
                <p className="mt-1.5 text-sm" style={{ color: 'var(--text-3)' }}>Try a different search or category.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    onApply={() => setApplying(t)}
                    onExport={() => onExport(t)}
                    onEdit={t.builtin ? undefined : () => setEditing(t)}
                    onDelete={t.builtin ? undefined : () => setDeleteTarget(t)}
                  />
                ))}
              </div>
            )}
          </div>
        </CategorySection>
      </div>

      {creating && (
        <TemplateCreatePanel
          guildId={guildId}
          capturable={capturableSections}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            setTab('library')
          }}
        />
      )}

      {importing && (
        <TemplateImportPanel
          guildId={guildId}
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false)
            setTab('library')
          }}
        />
      )}

      {applying && (
        <TemplateApplyWizard
          guildId={guildId}
          guildName={guildName}
          template={applying}
          snapshot={snapshot}
          onClose={() => setApplying(null)}
        />
      )}

      {editing && (
        <TemplateEditPanel
          guildId={guildId}
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete template?"
          description={`"${deleteTarget.name}" will be removed from your library. This can't be undone.`}
          confirmLabel="Delete"
          tone="destructive"
          busy={deletingId !== null}
          onConfirm={onConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function EmptyLibrary({ onCreate, onBrowse }: { onCreate: () => void; onBrowse: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border py-16 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
        <LayoutTemplate size={26} />
      </div>
      <p className="font-semibold text-foreground">No saved templates yet</p>
      <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
        Capture the current server setup as a reusable template, import one from JSON, or start from an official preset.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button onClick={onCreate} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white" style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}>
          <Plus size={15} /> Save as template
        </button>
        <button onClick={onBrowse} className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
          <Star size={15} /> Browse presets
        </button>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}1f`, color }}>
          {icon}
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p className="font-mono text-3xl font-bold text-foreground">{value.toLocaleString()}</p>
    </div>
  )
}
