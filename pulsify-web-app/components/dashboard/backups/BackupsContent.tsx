'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  DatabaseBackup,
  GitCompareArrows,
  RotateCcw,
  Trash2,
  Search,
  Download,
  Upload,
  Archive,
  HardDrive,
  Clock,
  ShieldCheck,
  Boxes,
  History,
  CalendarClock,
  Loader2,
  Check,
  ShieldAlert,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { HelpTip } from '@/components/ui/help-tip'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { createClient as createSupabase } from '@/lib/supabase'
import {
  BACKUP_TYPES,
  BACKUP_TYPE_META,
  BACKUP_SECTION_KEYS,
  SECTION_META,
  formatBytes,
  toBackupExport,
  exportFileName,
  type ServerBackup,
  type BackupSchedule,
  type RecoveryLogEntry,
  type BackupType,
} from '@/lib/backups'
import type { CaptureSnapshot } from '@/app/dashboard/[guildId]/backups/page'
import { deleteBackup, loadRecoveryLogs } from '@/app/dashboard/[guildId]/backups/actions'
import { BackupIcon } from './icons'
import { CreateBackupDialog } from './CreateBackupDialog'
import { BackupImportPanel } from './BackupImportPanel'
import { RestoreWizard } from './RestoreWizard'
import { CompareDialog } from './CompareDialog'
import { ScheduleCard } from './ScheduleCard'
import { RecoveryLog } from './RecoveryLog'
import { LocalTime } from './LocalTime'

type TypeFilter = 'all' | BackupType
type Tab = 'backups' | 'logs'

export function BackupsContent({
  guildId,
  guildName,
  backups,
  schedule,
  logs,
  logsHasMore,
  snapshot,
}: {
  guildId: string
  guildName: string
  backups: ServerBackup[]
  schedule: BackupSchedule
  logs: RecoveryLogEntry[]
  logsHasMore: boolean
  snapshot: CaptureSnapshot
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<Tab>('backups')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  // Recovery log: the Logs tab starts with the first page from props and pages
  // in 25 at a time. Re-sync when props change (realtime refresh bumps new
  // activity to the top — simplest to reset to the first page).
  const [logEntries, setLogEntries] = useState<RecoveryLogEntry[]>(logs)
  const [logsMore, setLogsMore] = useState(logsHasMore)
  const [loadingMore, startLoadMore] = useTransition()
  useEffect(() => {
    setLogEntries(logs)
    setLogsMore(logsHasMore)
  }, [logs, logsHasMore])

  function loadMoreLogs() {
    startLoadMore(async () => {
      const res = await loadRecoveryLogs(guildId, logEntries.length)
      if (res.ok) {
        // De-dupe defensively in case a realtime refresh shifted the window.
        setLogEntries((prev) => {
          const seen = new Set(prev.map((e) => e.id))
          return [...prev, ...res.data.entries.filter((e) => !seen.has(e.id))]
        })
        setLogsMore(res.data.hasMore)
      }
    })
  }

  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<ServerBackup | null>(null)
  const [comparing, setComparing] = useState<{ baseId?: string; targetId?: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ServerBackup | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteBusy, startDelete] = useTransition()

  // Quick-action deep links: ?new=1 / ?import=1 (parity with Templates).
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

  // Realtime: refresh as the bot creates scheduled backups / prunes / logs land.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const supabase = createSupabase()
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => startTransition(() => router.refresh()), 800)
    }
    const channel = supabase
      .channel(`server_backups:${guildId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'server_backups', filter: `guild_id=eq.${guildId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recovery_logs', filter: `guild_id=eq.${guildId}` }, scheduleRefresh)
      .subscribe()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [guildId, router])

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return backups.filter((b) => {
      if (typeFilter !== 'all' && b.type !== typeFilter) return false
      if (!q) return true
      return b.name.toLowerCase().includes(q) || `#${b.version}`.includes(q)
    })
  }, [backups, search, typeFilter])

  const lastBackup = backups[0] ?? null
  const totalSize = useMemo(() => backups.reduce((sum, b) => sum + b.sizeBytes, 0), [backups])
  const scheduledCount = useMemo(() => backups.filter((b) => b.type !== 'manual').length, [backups])

  // Backup types present (for the filter chips).
  const usedTypes = useMemo(() => BACKUP_TYPES.filter((t) => backups.some((b) => b.type === t)), [backups])

  // Protection coverage: for each section, is it captured in the LATEST backup,
  // configured-but-not-yet-backed-up, or not set up at all? Drives the coverage
  // grid + progress bar that headline the page.
  const coverage = useMemo(() => {
    const latestKeys = new Set(backups[0]?.sectionKeys ?? [])
    return BACKUP_SECTION_KEYS.map((key) => {
      const inLatest = latestKeys.has(key)
      const configured = snapshot.capturable.includes(key)
      const status: 'protected' | 'at_risk' | 'inactive' = inLatest
        ? 'protected'
        : configured
          ? 'at_risk'
          : 'inactive'
      return { key, status }
    })
  }, [backups, snapshot.capturable])
  const relevant = coverage.filter((c) => c.status !== 'inactive')
  const protectedCount = coverage.filter((c) => c.status === 'protected').length
  const coveragePct = relevant.length ? Math.round((protectedCount / relevant.length) * 100) : 0

  function onExport(b: ServerBackup) {
    const blob = new Blob([JSON.stringify(toBackupExport(b, guildName), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = exportFileName(b.name)
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function handleDelete() {
    if (!deleteTarget) return
    setDeleteError(null)
    startDelete(async () => {
      const res = await deleteBackup(guildId, deleteTarget.id)
      if (res.ok) {
        setDeleteTarget(null)
        refresh()
      } else {
        setDeleteError(res.error)
      }
    })
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Backup & Restore"
        helpId="backups"
        description={
          <>
            Versioned snapshots of <span className="font-medium text-foreground">{guildName}</span> — capture, compare,
            share and restore safely
          </>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton onClick={refresh} refreshing={isPending} />
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
              <DatabaseBackup size={15} /> Create backup
            </button>
          </div>
        }
      />

      <div className="space-y-8">
        {/* At a glance */}
        <CategorySection icon={<Archive size={14} />} title="At a glance" description="Your server's recovery points.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Archive size={16} />} label="Backups" value={backups.length} color="#60a5fa" mono />
            <StatCard icon={<ShieldCheck size={16} />} label="Scheduled" value={scheduledCount} color="#34d399" mono />
            <StatCard icon={<HardDrive size={16} />} label="Total size" value={formatBytes(totalSize)} color="#f59e0b" />
            <StatCard
              icon={<Clock size={16} />}
              label="Last backup"
              value={lastBackup ? <LocalTime iso={lastBackup.createdAt} mode="date" /> : '—'}
              color="#8b5cf6"
            />
          </div>
        </CategorySection>

        {/* Protection coverage */}
        <CategorySection icon={<ShieldCheck size={14} />} title="Protection coverage" description="What your latest backup includes.">
          <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm" style={{ color: 'var(--text-2)' }}>
                {backups.length === 0 ? (
                  <>No backups yet — create one to protect your configuration.</>
                ) : (
                  <>
                    Your latest backup protects <span className="font-semibold text-foreground">{protectedCount}</span> of{' '}
                    <span className="font-semibold text-foreground">{relevant.length}</span> configured section
                    {relevant.length === 1 ? '' : 's'}.
                  </>
                )}
              </p>
              {relevant.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-28 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${coveragePct}%`, background: coveragePct === 100 ? '#22c55e' : 'var(--p-1)' }}
                    />
                  </div>
                  <span className="font-mono text-xs font-semibold" style={{ color: coveragePct === 100 ? '#22c55e' : 'var(--text-2)' }}>
                    {coveragePct}%
                  </span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {coverage.map(({ key, status }) => {
                const meta = SECTION_META[key]
                const tone =
                  status === 'protected'
                    ? { accent: '#22c55e', label: 'Protected' }
                    : status === 'at_risk'
                      ? { accent: '#f59e0b', label: 'Not backed up' }
                      : { accent: 'var(--text-3)', label: 'Not set up' }
                const dim = status === 'inactive'
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 rounded-lg border p-2.5"
                    style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', opacity: dim ? 0.6 : 1 }}
                    title={`${meta.label} — ${tone.label}`}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                      style={{ background: `color-mix(in srgb, ${meta.accent} 18%, transparent)`, color: meta.accent }}
                    >
                      <BackupIcon name={meta.icon} size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{meta.label}</p>
                      <p className="flex items-center gap-1 text-[10px]" style={{ color: tone.accent }}>
                        {status === 'protected' ? (
                          <Check size={9} />
                        ) : status === 'at_risk' ? (
                          <ShieldAlert size={9} />
                        ) : (
                          <span className="inline-block h-1 w-1 rounded-full" style={{ background: 'var(--text-3)' }} />
                        )}
                        {tone.label}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </CategorySection>

        {/* Schedule */}
        <CategorySection
          icon={<CalendarClock size={14} />}
          title="Automatic backups"
          helpId="backups-automatic"
          description="Let Pulse capture and prune backups on a schedule."
        >
          <ScheduleCard guildId={guildId} schedule={schedule} />
        </CategorySection>

        {/* Browse + recovery log — tabbed within one section */}
        <CategorySection icon={<Boxes size={14} />} title="Browse" description="Restore, compare and download backups — or review recovery activity.">
          {/* In-section tab switcher — scrolls on narrow screens instead of overflowing. */}
          <div className="max-w-full overflow-x-auto">
          <div className="inline-flex rounded-xl border p-1" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
            {([
              { id: 'backups' as Tab, label: 'Backups', icon: <Boxes size={15} /> },
              { id: 'logs' as Tab, label: 'Recovery log', icon: <History size={15} /> },
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
                </button>
              )
            })}
          </div>
          </div>

          {tab === 'backups' ? (
          <div className="space-y-4">
          {/* Search + type filter */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search backups…"
                className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </div>
            {usedTypes.length > 0 && (
              <div className="inline-flex flex-wrap rounded-lg border p-0.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
                {(['all', ...usedTypes] as TypeFilter[]).map((f) => {
                  const active = typeFilter === f
                  const label = f === 'all' ? 'All' : BACKUP_TYPE_META[f as BackupType].label
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setTypeFilter(f)}
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

          {/* List / empty states */}
          <div>
            {backups.length === 0 ? (
              <EmptyBackups onCreate={() => setCreating(true)} onImport={() => setImporting(true)} />
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border py-14 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
                  <Search size={22} />
                </div>
                <p className="font-semibold text-foreground">No matching backups</p>
                <p className="mt-1.5 text-sm" style={{ color: 'var(--text-3)' }}>Try a different search or type.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {filtered.map((b) => (
                  <BackupRow
                    key={b.id}
                    backup={b}
                    onRestore={() => setRestoreTarget(b)}
                    onCompare={() => setComparing({ targetId: b.id })}
                    onExport={() => onExport(b)}
                    onDelete={() => setDeleteTarget(b)}
                    canCompare={backups.length >= 2}
                  />
                ))}
              </ul>
            )}
          </div>
          </div>
          ) : (
          <div className="space-y-4">
            <RecoveryLog logs={logEntries} />
            {logsMore && (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={loadMoreLogs}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                  style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                >
                  {loadingMore && <Loader2 size={14} className="animate-spin" />}
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
          )}
        </CategorySection>
      </div>

      {/* Dialogs */}
      {creating && (
        <CreateBackupDialog
          guildId={guildId}
          snapshot={snapshot}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            refresh()
          }}
        />
      )}
      {importing && (
        <BackupImportPanel
          guildId={guildId}
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false)
            refresh()
          }}
        />
      )}
      {restoreTarget && (
        <RestoreWizard guildId={guildId} backup={restoreTarget} onClose={() => setRestoreTarget(null)} onDone={refresh} />
      )}
      {comparing && (
        <CompareDialog
          guildId={guildId}
          backups={backups}
          initialBaseId={comparing.baseId}
          initialTargetId={comparing.targetId}
          onClose={() => setComparing(null)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete backup?"
          description={`"${deleteTarget.name}" (#${deleteTarget.version}) will be permanently deleted. This can't be undone.`}
          confirmLabel="Delete backup"
          tone="destructive"
          busy={deleteBusy}
          error={deleteError}
          onCancel={() => {
            setDeleteTarget(null)
            setDeleteError(null)
          }}
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  color,
  mono,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  color: string
  mono?: boolean
}) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}1f`, color }}>
          {icon}
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p className={`font-bold text-foreground ${mono ? 'font-mono text-3xl' : 'text-2xl'}`}>{value}</p>
    </div>
  )
}

function EmptyBackups({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border py-16 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
        <DatabaseBackup size={26} />
      </div>
      <p className="font-semibold text-foreground">No backups yet</p>
      <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
        Capture a restorable snapshot of your roles, channels and feature configuration — or import one someone shared to
        clone their setup.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button onClick={onCreate} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white" style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}>
          <DatabaseBackup size={15} /> Create backup
        </button>
        <button onClick={onImport} className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
          <Upload size={15} /> Import backup
        </button>
      </div>
    </div>
  )
}

function BackupRow({
  backup,
  onRestore,
  onCompare,
  onExport,
  onDelete,
  canCompare,
}: {
  backup: ServerBackup
  onRestore: () => void
  onCompare: () => void
  onExport: () => void
  onDelete: () => void
  canCompare: boolean
}) {
  const typeMeta = BACKUP_TYPE_META[backup.type]
  return (
    <li
      className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center"
      style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{backup.name}</span>
          <span className="rounded-full px-1.5 py-0.5 text-[10px] font-mono" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
            #{backup.version}
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: `color-mix(in srgb, ${typeMeta.accent} 18%, transparent)`, color: typeMeta.accent }}
          >
            <BackupIcon name={typeMeta.icon} size={9} /> {typeMeta.label}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          <LocalTime iso={backup.createdAt} mode="datetime" /> · {formatBytes(backup.sizeBytes)} · v{backup.formatVersion}
          {backup.createdByName ? ` · ${backup.createdByName}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {backup.sectionKeys.map((key) => {
            const meta = SECTION_META[key]
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
                style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                title={meta.label}
              >
                <span style={{ color: meta.accent }}>
                  <BackupIcon name={meta.icon} size={10} />
                </span>
                {meta.label}
              </span>
            )
          })}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onRestore}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white transition"
          style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
        >
          <RotateCcw size={12} /> Restore
        </button>
        <HelpTip id="backups-restore" iconSize={14} side="bottom" />
        <IconButton title="Download / share" onClick={onExport}>
          <Download size={13} />
        </IconButton>
        {canCompare && (
          <IconButton title="Compare with another backup" onClick={onCompare}>
            <GitCompareArrows size={13} />
          </IconButton>
        )}
        <IconButton title="Delete backup" onClick={onDelete} danger>
          <Trash2 size={13} />
        </IconButton>
      </div>
    </li>
  )
}

function IconButton({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-lg border transition-colors"
      style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = danger ? '#f87171' : 'var(--text)'
        e.currentTarget.style.borderColor = danger ? 'rgba(239,68,68,0.4)' : 'var(--p-1)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-3)'
        e.currentTarget.style.borderColor = 'var(--line-strong)'
      }}
    >
      {children}
    </button>
  )
}
