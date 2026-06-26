'use client'

import { useMemo, useState } from 'react'
import {
  Network,
  Shield,
  Bot,
  Users,
  Crown,
  TrendingUp,
  Layers,
  RefreshCw,
  Download,
  Rows3,
  LayoutGrid,
  CircleSlash,
  CircleDot,
  Sparkles,
} from 'lucide-react'
import type { DiscordRole } from '@/lib/discord'
import {
  computeRoleHierarchy,
  CATEGORY_META,
  ROLE_CATEGORIES,
  type RoleCategory,
  type CategorizedRole,
} from '@/lib/role-hierarchy'
import { exportHierarchyPng } from '@/lib/role-hierarchy-export'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'

type Props = {
  roles: DiscordRole[]
  memberCountByRole: Map<string, number>
  /** Unique members holding at least one role — can't be derived from per-role counts. */
  membersWithRoles: number
  onSelectRole: (role: DiscordRole) => void
  onRefresh: () => void | Promise<void>
}

const CATEGORY_ICON: Record<RoleCategory, React.ReactNode> = {
  management: <Shield size={14} />,
  bots: <Bot size={14} />,
  community: <Users size={14} />,
}

export function RoleHierarchyContent({
  roles,
  memberCountByRole,
  membersWithRoles,
  onSelectRole,
  onRefresh,
}: Props) {
  const [view, setView] = useState<'expanded' | 'compact'>('expanded')
  const [refreshing, setRefreshing] = useState(false)

  const hierarchy = useMemo(
    () => computeRoleHierarchy(roles, memberCountByRole),
    [roles, memberCountByRole],
  )
  const { groups, stats, distribution, emptyVsActive } = hierarchy

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  // Empty state: a server with only @everyone has nothing to organize.
  if (stats.totalRoles === 0) {
    return (
      <EmptyState
        icon={<Network size={36} />}
        title="No roles to organize"
        description="This server only has the @everyone role. Create roles from the Roles tab and they'll be grouped here automatically."
      />
    )
  }

  const maxCatRoles = Math.max(1, ...distribution.map((d) => d.roleCount))
  const maxCatMembers = Math.max(1, ...distribution.map((d) => d.memberCount))
  const activePct =
    stats.totalRoles > 0 ? Math.round((emptyVsActive.active / stats.totalRoles) * 100) : 0

  return (
    <div className="space-y-8">
      {/* ── Statistics ─────────────────────────────────────────────────────── */}
      <CategorySection
        icon={<TrendingUp size={14} />}
        title="Role statistics"
        description="Key metrics across every role on this server."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={<Layers size={16} />} label="Total roles" value={stats.totalRoles} accent="var(--p-1)" />
          <Stat icon={<Users size={16} />} label="Members with roles" value={membersWithRoles} accent="#3b82f6" />
          <Stat icon={<CircleDot size={16} />} label="Roles with members" value={stats.rolesWithMembers} accent="#22c55e" />
          <Stat icon={<CircleSlash size={16} />} label="Empty roles" value={stats.emptyRoles} accent="#94a3b8" />
          <Stat icon={<Shield size={16} />} label="Management" value={stats.managementCount} accent={CATEGORY_META.management.accent} />
          <Stat icon={<Bot size={16} />} label="Bots" value={stats.botsCount} accent={CATEGORY_META.bots.accent} />
          <Stat icon={<Users size={16} />} label="Community" value={stats.communityCount} accent={CATEGORY_META.community.accent} />
          <Stat icon={<Sparkles size={16} />} label="Categories" value={distribution.filter((d) => d.roleCount > 0).length} accent="#a855f7" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <InfoCard
            icon={<Crown size={16} />}
            label="Highest role"
            accent="#f59e0b"
            color={stats.highestRole?.color}
            value={stats.highestRole ? `@${stats.highestRole.name}` : '—'}
          />
          <InfoCard
            icon={<TrendingUp size={16} />}
            label="Most assigned role"
            accent="#22c55e"
            color={stats.mostAssignedRole?.color}
            value={stats.mostAssignedRole ? `@${stats.mostAssignedRole.name}` : '—'}
            hint={
              stats.mostAssignedRole
                ? `${stats.mostAssignedRole.count.toLocaleString()} member${stats.mostAssignedRole.count === 1 ? '' : 's'}`
                : undefined
            }
          />
        </div>
      </CategorySection>

      {/* ── Distribution ───────────────────────────────────────────────────── */}
      <CategorySection
        icon={<Layers size={14} />}
        title="Distribution"
        description="How roles and members are spread across the categories."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Roles per category */}
          <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Roles per category</p>
            <div className="space-y-2.5">
              {distribution.map((d) => (
                <Bar
                  key={d.category}
                  label={CATEGORY_META[d.category].label}
                  value={d.roleCount}
                  max={maxCatRoles}
                  accent={CATEGORY_META[d.category].accent}
                />
              ))}
            </div>
          </div>

          {/* Members per category */}
          <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Members per category</p>
            <div className="space-y-2.5">
              {distribution.map((d) => (
                <Bar
                  key={d.category}
                  label={CATEGORY_META[d.category].label}
                  value={d.memberCount}
                  max={maxCatMembers}
                  accent={CATEGORY_META[d.category].accent}
                />
              ))}
            </div>
          </div>

          {/* Empty vs active */}
          <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Empty vs active roles</p>
            <div className="flex h-3 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
              <div className="h-full" style={{ width: `${activePct}%`, background: '#22c55e' }} title={`${emptyVsActive.active} active`} />
              <div className="h-full flex-1" style={{ background: '#94a3b8', opacity: 0.5 }} title={`${emptyVsActive.empty} empty`} />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#22c55e' }} />
                <span className="text-foreground">{emptyVsActive.active}</span>
                <span className="text-subtle">active</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#94a3b8' }} />
                <span className="text-foreground">{emptyVsActive.empty}</span>
                <span className="text-subtle">empty</span>
              </span>
            </div>
            <p className="mt-3 text-xs text-subtle">{activePct}% of roles have at least one member.</p>
          </div>
        </div>
      </CategorySection>

      {/* ── Hierarchy ──────────────────────────────────────────────────────── */}
      <CategorySection
        icon={<Network size={14} />}
        title="Hierarchy"
        description="Roles grouped into categories, top-down by position. Click any role to edit it."
        helpId="role-hierarchy"
      >
        {/* Controls sit below the section title, aligned right. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* View toggle */}
          <div className="inline-flex rounded-lg border p-0.5" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
            <ViewToggleButton active={view === 'expanded'} onClick={() => setView('expanded')} title="Expanded view">
              <Rows3 size={14} />
            </ViewToggleButton>
            <ViewToggleButton active={view === 'compact'} onClick={() => setView('compact')} title="Compact view">
              <LayoutGrid size={14} />
            </ViewToggleButton>
          </div>
          <button
            type="button"
            onClick={() => exportHierarchyPng(hierarchy)}
            title="Export as PNG"
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:bg-[var(--bg-2)]"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <Download size={14} /> PNG
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh hierarchy data"
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:bg-[var(--bg-2)] disabled:opacity-60"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} /> Refresh
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {ROLE_CATEGORIES.map((category) => (
            <CategoryCard
              key={category}
              category={category}
              roles={groups[category]}
              view={view}
              onSelectRole={onSelectRole}
            />
          ))}
        </div>
      </CategorySection>
    </div>
  )
}

function ViewToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className="flex h-7 w-7 items-center justify-center rounded-md transition"
      style={active ? { background: 'var(--p-soft)', color: 'var(--p-1)' } : { color: 'var(--text-3)' }}
    >
      {children}
    </button>
  )
}

function CategoryCard({
  category,
  roles,
  view,
  onSelectRole,
}: {
  category: RoleCategory
  roles: CategorizedRole[]
  view: 'expanded' | 'compact'
  onSelectRole: (role: DiscordRole) => void
}) {
  const meta = CATEGORY_META[category]
  const members = roles.reduce((sum, r) => sum + r.memberCount, 0)

  return (
    <div
      className="flex flex-col overflow-hidden rounded-xl border"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      {/* Card header */}
      <div
        className="flex items-center gap-2.5 border-b px-4 py-3"
        style={{ borderColor: 'var(--line-strong)', background: `color-mix(in srgb, ${meta.accent} 8%, transparent)` }}
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in srgb, ${meta.accent} 16%, transparent)`, color: meta.accent }}
        >
          {CATEGORY_ICON[category]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{meta.label}</p>
          <p className="truncate text-xs text-subtle">{meta.description}</p>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{ background: `color-mix(in srgb, ${meta.accent} 16%, transparent)`, color: meta.accent }}
        >
          {roles.length}
        </span>
      </div>

      {/* Card body */}
      {roles.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-subtle">No roles in this category.</div>
      ) : view === 'compact' ? (
        <div className="flex flex-wrap gap-1.5 p-3">
          {roles.map((r) => (
            <button
              key={r.role.id}
              type="button"
              onClick={() => onSelectRole(r.role)}
              title={`${r.reason} · ${r.memberCount} member${r.memberCount === 1 ? '' : 's'}`}
              className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition hover:bg-[var(--bg-2)]"
              style={{ borderColor: 'var(--line-strong)' }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />
              <span className="max-w-[120px] truncate font-medium" style={{ color: r.role.color !== 0 ? r.color : 'var(--text)' }}>
                {r.role.name}
              </span>
              <span className="font-mono text-[10px] text-subtle">{r.memberCount}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--line-strong)' }}>
          {roles.map((r) => (
            <RoleRow key={r.role.id} role={r} onClick={() => onSelectRole(r.role)} />
          ))}
        </div>
      )}

      {/* Card footer — member roll-up */}
      {roles.length > 0 && (
        <div
          className="mt-auto flex items-center justify-between border-t px-4 py-2 text-xs"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
        >
          <span>{roles.length} role{roles.length === 1 ? '' : 's'}</span>
          <span>{members.toLocaleString()} member{members === 1 ? '' : 's'}</span>
        </div>
      )}
    </div>
  )
}

function RoleRow({ role, onClick }: { role: CategorizedRole; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={role.reason}
      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-[var(--bg-2)]"
      style={{ borderColor: 'var(--line-strong)' }}
    >
      <span className="h-3 w-3 shrink-0 rounded-full border" style={{ background: role.color, borderColor: 'var(--line-strong)' }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium" style={{ color: role.role.color !== 0 ? role.color : 'var(--text)' }}>
          @{role.role.name}
        </span>
        <span className="block truncate text-xs text-subtle">{role.reason}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-xs text-muted-foreground">
          {role.memberCount.toLocaleString()}
        </span>
        <span className="block text-[10px] text-subtle">#{role.role.position}</span>
      </span>
    </button>
  )
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
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

function InfoCard({
  icon,
  label,
  value,
  accent,
  color,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  accent: string
  color?: string
  hint?: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-subtle">{label}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
          {color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />}
          <span className="truncate">{value}</span>
        </p>
      </div>
      {hint && <span className="shrink-0 text-xs text-subtle">{hint}</span>}
    </div>
  )
}

function Bar({ label, value, max, accent }: { label: string; value: number; max: number; accent: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate text-sm text-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
        <div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: accent }} />
      </div>
      <span className="w-10 shrink-0 text-right text-xs font-mono text-subtle">{value.toLocaleString()}</span>
    </div>
  )
}
