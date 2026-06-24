'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Clock, Plus, Search, AlertCircle, Trash2, Minus, History,
  Timer, Hourglass, Activity, CheckCircle2, X, Users,
} from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { roleColor, type DiscordRole } from '@/lib/discord'
import {
  computeTempRoleStats, formatRemaining, isExpiringSoon, addDuration,
  SOURCE_META, STATUS_META, TEMP_ROLE_SOURCES, DURATION_UNITS, UNIT_LABELS,
  type TempRoleAssignment, type TempRoleEvent, type TempRoleStatus, type TempRoleSource, type DurationUnit,
} from '@/lib/temporary-roles'
import { AssignTempRolePanel, type TempRoleMember } from './AssignTempRolePanel'

type Props = { guildId: string; roles: DiscordRole[] }
type Toast = { kind: 'ok' | 'err'; text: string }
type Dialog =
  | { type: 'extend' | 'shorten'; row: TempRoleAssignment }
  | { type: 'remove'; row: TempRoleAssignment }
  | { type: 'bulkRemove' }
  | null

const ACTION_VERB: Record<TempRoleEvent['action'], string> = {
  assigned: 'assigned', extended: 'extended', shortened: 'shortened', expired: 'expired', removed: 'removed',
}

// Subtract a {value, unit} from a date (extend uses addDuration directly).
function subtractDuration(base: Date, value: number, unit: DurationUnit): Date {
  if (unit === 'months') {
    const d = new Date(base)
    d.setMonth(d.getMonth() - Math.max(0, Math.floor(value)))
    return d
  }
  const per = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 }[unit]
  return new Date(base.getTime() - Math.max(0, Math.floor(value)) * per)
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}>{icon}</span>
      <div className="min-w-0">
        <p className="text-2xl font-semibold leading-none text-foreground">{value.toLocaleString()}</p>
        <p className="mt-1 text-xs text-subtle">{label}</p>
      </div>
    </div>
  )
}

function SourceChip({ source }: { source: TempRoleSource }) {
  const meta = SOURCE_META[source] ?? SOURCE_META.other
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: `color-mix(in srgb, ${meta.accent} 14%, transparent)`, color: meta.accent }}>
      {meta.label}
    </span>
  )
}

export function TemporaryRolesContent({ guildId, roles }: Props) {
  const [assignments, setAssignments] = useState<TempRoleAssignment[]>([])
  const [events, setEvents] = useState<TempRoleEvent[]>([])
  const [members, setMembers] = useState<TempRoleMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  // Ticks every 30s so the countdown badges stay live without a per-row timer.
  const [now, setNow] = useState(() => Date.now())

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | TempRoleStatus>('active')
  const [sourceFilter, setSourceFilter] = useState<'all' | TempRoleSource>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [assignOpen, setAssignOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const roleName = useCallback((id: string) => roles.find((r) => r.id === id)?.name ?? null, [roles])

  const fetchAll = useCallback(async () => {
    const [listRes, membersRes] = await Promise.all([
      fetch(`/api/discord/guild/${guildId}/temporary-roles`, { cache: 'no-store' }),
      fetch(`/api/discord/guild/${guildId}/members?limit=1000`, { cache: 'no-store' }),
    ])
    if (!listRes.ok) {
      const data = (await listRes.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Could not load temporary roles.')
      setLoading(false)
      return
    }
    const data = (await listRes.json()) as { assignments: TempRoleAssignment[]; events: TempRoleEvent[] }
    setAssignments(data.assignments ?? [])
    setEvents(data.events ?? [])
    if (membersRes.ok) setMembers((await membersRes.json()) as TempRoleMember[])
    setError(null)
    setLoading(false)
  }, [guildId])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const stats = useMemo(() => computeTempRoleStats(assignments, now), [assignments, now])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return assignments.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false
      if (sourceFilter !== 'all' && a.source !== sourceFilter) return false
      if (q) {
        const hay = `${a.user_name ?? ''} ${a.role_name ?? roleName(a.role_id) ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [assignments, statusFilter, sourceFilter, query, roleName])

  const selectedActive = useMemo(
    () => filtered.filter((a) => selected.has(a.id) && a.status === 'active'),
    [filtered, selected],
  )

  function toggle(id: string) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  async function changeExpiry(row: TempRoleAssignment, newExpiry: Date) {
    setActing(true)
    setActionError(null)
    const res = await fetch(`/api/discord/guild/${guildId}/temporary-roles/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresAt: newExpiry.toISOString() }),
    })
    setActing(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setActionError(data.error ?? 'Update failed.')
      return
    }
    setDialog(null)
    setToast({ kind: 'ok', text: 'Expiration updated.' })
    await fetchAll()
  }

  async function removeOne(row: TempRoleAssignment) {
    setActing(true)
    setActionError(null)
    const res = await fetch(`/api/discord/guild/${guildId}/temporary-roles/${row.id}`, { method: 'DELETE' })
    setActing(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setActionError(data.error ?? 'Remove failed.')
      return
    }
    setDialog(null)
    setToast({ kind: 'ok', text: 'Temporary role removed.' })
    await fetchAll()
  }

  async function bulkRemove() {
    setActing(true)
    const res = await fetch(`/api/discord/guild/${guildId}/temporary-roles/bulk-remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedActive.map((a) => a.id) }),
    })
    setActing(false)
    setDialog(null)
    setSelected(new Set())
    if (!res.ok) { setToast({ kind: 'err', text: 'Bulk remove failed.' }); return }
    const data = (await res.json()) as { removed: number }
    setToast({ kind: 'ok', text: `Removed ${data.removed} temporary role${data.removed === 1 ? '' : 's'}.` })
    await fetchAll()
  }

  function confirmExpiryChange(values: Record<string, string>) {
    if (!dialog || (dialog.type !== 'extend' && dialog.type !== 'shorten')) return
    const value = Math.max(1, Number(values.value) || 1)
    const unit = (DURATION_UNITS.includes(values.unit as DurationUnit) ? values.unit : 'days') as DurationUnit
    const base = new Date(dialog.row.expires_at)
    const next = dialog.type === 'extend' ? addDuration(base, value, unit) : subtractDuration(base, value, unit)
    void changeExpiry(dialog.row, next)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return <TableSkeleton rows={6} columns={5} />

  if (error) {
    return <EmptyState icon={<AlertCircle size={24} />} title="Couldn't load temporary roles" description={error} variant="muted" />
  }

  const unitOptions = DURATION_UNITS.map((u) => ({ label: UNIT_LABELS[u], value: u }))

  return (
    <div className="space-y-8">
      <CategorySection icon={<Activity size={14} />} title="At a glance" description="Live monitoring of time-limited role grants on this server.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<Clock size={16} />} label="Active" value={stats.active} accent="#22c55e" />
          <StatCard icon={<Hourglass size={16} />} label="Expiring in 24h" value={stats.expiringSoon} accent="#f59e0b" />
          <StatCard icon={<Timer size={16} />} label="Expired (7d)" value={stats.recentlyExpired} accent="#94a3b8" />
          <StatCard icon={<Users size={16} />} label="Total tracked" value={assignments.length} accent="var(--p-1)" />
        </div>

        {(stats.byRole.length > 0 || stats.trend.some((d) => d.count > 0)) && (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Most assigned */}
            <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Most assigned roles</p>
              {stats.byRole.length === 0 ? (
                <p className="text-sm text-subtle">No assignments yet.</p>
              ) : (
                <div className="space-y-2">
                  {stats.byRole.map((r) => {
                    const max = stats.byRole[0].count || 1
                    return (
                      <div key={r.roleId} className="flex items-center gap-2">
                        <span className="w-32 shrink-0 truncate text-sm text-foreground">{r.roleName ?? roleName(r.roleId) ?? 'Unknown role'}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
                          <div className="h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: 'var(--p-1)' }} />
                        </div>
                        <span className="w-8 shrink-0 text-right text-xs font-mono text-subtle">{r.count}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 14-day trend */}
            <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Assignment trend (14 days)</p>
              <div className="flex h-20 items-end gap-1">
                {stats.trend.map((d) => {
                  const max = Math.max(1, ...stats.trend.map((x) => x.count))
                  return (
                    <div key={d.date} className="flex-1 rounded-t" title={`${d.date}: ${d.count}`} style={{ height: `${Math.max(4, (d.count / max) * 100)}%`, background: d.count > 0 ? 'var(--p-1)' : 'var(--bg-2)' }} />
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </CategorySection>

      <CategorySection
        icon={<Clock size={14} />}
        title="Assignments"
        description="Assign, extend, shorten and remove time-limited roles."
      >
        {/* Toolbar — capped search on the left, filters + Assign grouped on the
            right (mirrors the Events / Scheduled toolbars). */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search member or role…" className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | TempRoleStatus)} className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="removed">Removed</option>
            </select>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as 'all' | TempRoleSource)} className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
              <option value="all">All sources</option>
              {TEMP_ROLE_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_META[s].label}</option>)}
            </select>
            <button type="button" onClick={() => setAssignOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition" style={{ background: 'var(--p-1)', color: '#fff' }}>
              <Plus size={14} /> Assign role
            </button>
          </div>
        </div>

        {/* Bulk bar */}
        {selectedActive.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border px-4 py-2.5" style={{ borderColor: 'var(--p-1)', background: 'var(--p-soft)' }}>
            <span className="text-sm font-medium text-foreground">{selectedActive.length} active selected</span>
            <button type="button" onClick={() => setDialog({ type: 'bulkRemove' })} className="ml-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition" style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
              <Trash2 size={13} /> Remove selected
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground" aria-label="Clear selection"><X size={13} /></button>
          </div>
        )}

        {/* Table */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Clock size={32} />}
            title={assignments.length === 0 ? 'No temporary roles yet' : 'No matches'}
            description={assignments.length === 0 ? 'Assign a time-limited role — Pulse removes it automatically when it expires.' : 'Try a different search or filter.'}
            variant={assignments.length === 0 ? 'accent' : 'muted'}
            action={assignments.length === 0 ? (
              <button type="button" onClick={() => setAssignOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}><Plus size={15} /> Assign a role</button>
            ) : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line-strong)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-subtle" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
                  <th className="px-3 py-2 font-semibold"></th>
                  <th className="px-3 py-2 font-semibold">Member</th>
                  <th className="px-3 py-2 font-semibold">Role</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Remaining</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const rName = a.role_name ?? roleName(a.role_id) ?? 'Unknown role'
                  const r = roles.find((x) => x.id === a.role_id)
                  const soon = a.status === 'active' && isExpiringSoon(a.expires_at, now)
                  return (
                    <tr key={a.id} className="border-b transition-colors hover:bg-[var(--bg-2)]" style={{ borderColor: 'var(--line-strong)' }}>
                      <td className="px-3 py-2">
                        {a.status === 'active' && (
                          <button type="button" onClick={() => toggle(a.id)} aria-label="Select" className="flex h-4 w-4 items-center justify-center rounded border" style={{ background: selected.has(a.id) ? 'var(--p-1)' : 'transparent', borderColor: selected.has(a.id) ? 'var(--p-1)' : 'var(--line-strong)', color: '#fff' }}>
                            {selected.has(a.id) && <CheckCircle2 size={11} />}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium text-foreground">{a.user_name ?? a.user_id}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: r ? roleColor(r.color) : '#99aab5' }} />
                          <span className="text-foreground">{rName}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2"><SourceChip source={a.source} /></td>
                      <td className="px-3 py-2">
                        {a.status === 'active' ? (
                          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium" style={soon ? { background: 'rgba(245,158,11,0.12)', color: '#f59e0b' } : { background: 'var(--bg-2)', color: 'var(--text-2)' }} title={new Date(a.expires_at).toLocaleString()}>
                            <Clock size={11} /> {formatRemaining(a.expires_at, now)}
                          </span>
                        ) : (
                          <span className="text-xs text-subtle" title={a.ended_at ? new Date(a.ended_at).toLocaleString() : undefined}>
                            {a.ended_at ? new Date(a.ended_at).toLocaleDateString() : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: STATUS_META[a.status].color }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_META[a.status].color }} />
                          {STATUS_META[a.status].label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {a.status === 'active' ? (
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" onClick={() => { setActionError(null); setDialog({ type: 'extend', row: a }) }} title="Extend" className="rounded p-1 text-muted-foreground transition hover:text-foreground"><Plus size={14} /></button>
                            <button type="button" onClick={() => { setActionError(null); setDialog({ type: 'shorten', row: a }) }} title="Shorten" className="rounded p-1 text-muted-foreground transition hover:text-foreground"><Minus size={14} /></button>
                            <button type="button" onClick={() => { setActionError(null); setDialog({ type: 'remove', row: a }) }} title="Remove now" className="rounded p-1 transition" style={{ color: '#f87171' }}><Trash2 size={14} /></button>
                          </div>
                        ) : (
                          <span className="block text-right text-xs text-subtle">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CategorySection>

      {events.length > 0 && (
        <CategorySection icon={<History size={14} />} title="Recent activity" description="Audit log of every temporary-role lifecycle event.">
          <div className="space-y-1.5">
            {events.slice(0, 20).map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SOURCE_META[e.source]?.accent ?? '#94a3b8' }} />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  <span className="font-medium">{e.role_name ?? roleName(e.role_id) ?? 'A role'}</span>{' '}
                  <span className="text-subtle">{ACTION_VERB[e.action]}</span>{' '}
                  for <span className="font-medium">{e.user_name ?? e.user_id}</span>
                  {e.actor_name && <span className="text-subtle"> by {e.actor_name}</span>}
                </span>
                <span className="shrink-0 text-xs text-subtle">{new Date(e.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CategorySection>
      )}

      {assignOpen && (
        <AssignTempRolePanel
          guildId={guildId}
          roles={roles}
          members={members}
          onClose={() => setAssignOpen(false)}
          onAssigned={(msg) => { setAssignOpen(false); setToast({ kind: 'ok', text: msg }); void fetchAll() }}
        />
      )}

      {(dialog?.type === 'extend' || dialog?.type === 'shorten') && (
        <ConfirmDialog
          title={`${dialog.type === 'extend' ? 'Extend' : 'Shorten'} @${dialog.row.role_name ?? 'role'}`}
          description={`Currently expires ${new Date(dialog.row.expires_at).toLocaleString()}.`}
          confirmLabel={dialog.type === 'extend' ? 'Extend' : 'Shorten'}
          busy={acting}
          error={actionError}
          fields={[
            { key: 'value', kind: 'number', label: 'Amount', defaultValue: 7, min: 1 },
            { key: 'unit', kind: 'select', label: 'Unit', options: unitOptions, defaultValue: 'days' },
          ]}
          onCancel={() => setDialog(null)}
          onConfirm={confirmExpiryChange}
        />
      )}

      {dialog?.type === 'remove' && (
        <ConfirmDialog
          title={`Remove @${dialog.row.role_name ?? 'role'}?`}
          description={`This removes the role from ${dialog.row.user_name ?? 'the member'} now.`}
          confirmLabel="Remove"
          tone="destructive"
          busy={acting}
          error={actionError}
          onCancel={() => setDialog(null)}
          onConfirm={() => removeOne(dialog.row)}
        />
      )}

      {dialog?.type === 'bulkRemove' && (
        <ConfirmDialog
          title={`Remove ${selectedActive.length} temporary role${selectedActive.length === 1 ? '' : 's'}?`}
          description="The roles are removed from the members now."
          confirmLabel={`Remove ${selectedActive.length}`}
          tone="destructive"
          busy={acting}
          onCancel={() => setDialog(null)}
          onConfirm={bulkRemove}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-[70] flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-xl" style={{ background: 'var(--panel)', borderColor: toast.kind === 'ok' ? 'var(--p-1)' : 'rgba(239,68,68,0.5)', color: 'var(--text)' }}>
          {toast.kind === 'ok' ? <CheckCircle2 size={14} style={{ color: 'var(--p-1)' }} /> : <AlertCircle size={14} style={{ color: '#f87171' }} />}
          {toast.text}
        </div>
      )}
    </div>
  )
}
