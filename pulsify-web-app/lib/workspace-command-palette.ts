// Workspace command palette + global search — shared types, the static
// command/action catalog, and the pure search engine that ranks a fetched index
// against a query. This is the workspace-scoped sibling of lib/command-palette.ts
// (the per-guild palette): no Discord members/channels/moderation here — the
// workspace area indexes its own collaborative data (servers, team, notes,
// tasks, incidents). No JSX or framework imports: icons are referenced by lucide
// name and resolved in the UI layer.

import { fuzzyMatchFields } from '@/lib/fuzzy'
import {
  can,
  type Capability,
  type IncidentStatus,
  type Priority,
  type Severity,
  type TaskStatus,
  type WorkspaceRole,
} from '@/lib/workspace'

// ── Categories ────────────────────────────────────────────────────────────────

export type WsSearchCategory =
  | 'action'
  | 'navigation'
  | 'server'
  | 'member'
  | 'note'
  | 'task'
  | 'incident'

export const WS_CATEGORY_META: Record<
  WsSearchCategory,
  { label: string; icon: string; accent: string; order: number }
> = {
  action: { label: 'Quick actions', icon: 'Zap', accent: 'var(--p-1)', order: 0 },
  navigation: { label: 'Go to', icon: 'Compass', accent: 'var(--text-2)', order: 1 },
  server: { label: 'Servers', icon: 'Server', accent: '#22d3ee', order: 2 },
  member: { label: 'Team', icon: 'Users', accent: '#60a5fa', order: 3 },
  note: { label: 'Notes', icon: 'StickyNote', accent: '#a855f7', order: 4 },
  task: { label: 'Tasks', icon: 'ListChecks', accent: '#10b981', order: 5 },
  incident: { label: 'Incidents', icon: 'ShieldAlert', accent: '#f87171', order: 6 },
}

// ── Result + action shapes ──────────────────────────────────────────────────
// The workspace palette is navigate-only: every result jumps somewhere in the
// /workspace route tree. No member-moderation / sync sub-modes (those are the
// per-guild palette's job).

export type WsResultAction = { kind: 'navigate'; href: string }

export type WsSearchResult = {
  /** Stable id, unique across a single render. */
  id: string
  category: WsSearchCategory
  title: string
  subtitle?: string
  /** lucide icon name; resolved in the UI. */
  icon: string
  /** Optional icon-chip accent override (defaults to the category accent). */
  accent?: string
  /** Avatar/icon URL — rendered instead of the icon chip. */
  imageUrl?: string
  /** Short uppercase tag rendered on the right (role, status, severity). */
  badge?: string
  action: WsResultAction
  /** Relevance score from the fuzzy matcher (0 for the static empty-state list). */
  score: number
}

// ── Static catalog: navigation + quick actions ──────────────────────────────
// `path` is appended to `/workspace/{workspaceId}`. `cap` mirrors the sidebar's
// capability gating so a member never sees a destination they can't open.

type WsNavDef = { id: string; label: string; icon: string; path: string; keywords?: string; cap?: Capability }

const WS_NAV_CATALOG: WsNavDef[] = [
  { id: 'wnav-overview', label: 'Overview', icon: 'Home', path: '', keywords: 'home dashboard summary branding settings' },
  { id: 'wnav-servers', label: 'Servers', icon: 'Server', path: '/servers', keywords: 'guilds servers tags add' },
  { id: 'wnav-team', label: 'Team', icon: 'Users', path: '/team', keywords: 'members staff roles invites collaborators people' },
  { id: 'wnav-notes', label: 'Notes', icon: 'StickyNote', path: '/notes', keywords: 'notes shared knowledge' },
  { id: 'wnav-tasks', label: 'Tasks', icon: 'ListChecks', path: '/tasks', keywords: 'tasks board todo assignments' },
  { id: 'wnav-incidents', label: 'Incidents', icon: 'ShieldAlert', path: '/incidents', keywords: 'incidents reports response' },
  { id: 'wnav-moderation', label: 'Moderation', icon: 'Eye', path: '/moderation', keywords: 'watchlist scam banned cross-server moderation logs', cap: 'manageWatchlist' },
  { id: 'wnav-analytics', label: 'Analytics', icon: 'LineChart', path: '/analytics', keywords: 'analytics stats charts comparison growth', cap: 'viewAnalytics' },
]

type WsActionDef = { id: string; label: string; subtitle?: string; icon: string; keywords?: string; path: string; cap?: Capability }

const WS_ACTION_CATALOG: WsActionDef[] = [
  { id: 'wact-add-server', label: 'Add a server', subtitle: 'Link a Discord server to this workspace', icon: 'Plus', keywords: 'add server guild link connect', path: '/servers', cap: 'manageServers' },
  { id: 'wact-invite-teammate', label: 'Invite a teammate', subtitle: 'Create a join link for a collaborator', icon: 'UserPlus', keywords: 'invite member teammate staff link', path: '/team', cap: 'manageMembers' },
  { id: 'wact-new-note', label: 'New note', subtitle: 'Write a shared note', icon: 'StickyNote', keywords: 'new note write add', path: '/notes', cap: 'manageNotes' },
  { id: 'wact-new-task', label: 'New task', subtitle: 'Add a task to the board', icon: 'ListChecks', keywords: 'new task add todo assign', path: '/tasks', cap: 'manageTasks' },
  { id: 'wact-report-incident', label: 'Report an incident', subtitle: 'Open a new incident', icon: 'ShieldAlert', keywords: 'incident report open new', path: '/incidents', cap: 'manageIncidents' },
  { id: 'wact-open-analytics', label: 'Open analytics', subtitle: 'Cross-server analytics overview', icon: 'LineChart', keywords: 'analytics stats overview', path: '/analytics', cap: 'viewAnalytics' },
]

function withWorkspace(workspaceId: string, path: string): string {
  return `/workspace/${workspaceId}${path}`
}

// ── Search index (snapshot the API returns and the client caches) ────────────

export type WsIndexServer = {
  guildId: string
  name: string
  iconUrl: string | null
  memberCount: number | null
  tags: string[]
  botInstalled: boolean
}
export type WsIndexMember = {
  userId: string
  name: string
  avatar: string | null
  role: WorkspaceRole
}
export type WsIndexNote = { id: string; body: string; author: string | null; pinned: boolean }
export type WsIndexTask = {
  id: string
  title: string
  status: TaskStatus
  priority: Priority
}
export type WsIndexIncident = {
  id: string
  title: string
  status: IncidentStatus
  severity: Severity
}

export type WorkspaceSearchIndex = {
  servers: WsIndexServer[]
  members: WsIndexMember[]
  notes: WsIndexNote[]
  tasks: WsIndexTask[]
  incidents: WsIndexIncident[]
  generatedAt: string
}

export const WS_EMPTY_INDEX: WorkspaceSearchIndex = {
  servers: [],
  members: [],
  notes: [],
  tasks: [],
  incidents: [],
  generatedAt: '',
}

// ── Display helpers ─────────────────────────────────────────────────────────

const TASK_STATUS_TAG: Record<TaskStatus, string> = { open: 'OPEN', in_progress: 'ACTIVE', done: 'DONE' }
const INCIDENT_STATUS_TAG: Record<IncidentStatus, string> = {
  open: 'OPEN', investigating: 'INVESTIGATING', resolved: 'RESOLVED', closed: 'CLOSED',
}
const ROLE_TAG: Record<WorkspaceRole, string> = {
  owner: 'OWNER', admin: 'ADMIN', moderator: 'MOD', analyst: 'ANALYST', support: 'SUPPORT',
}

// ── Search engine ────────────────────────────────────────────────────────────

/** Per-category cap in the combined results view. */
export const WS_CATEGORY_LIMIT = 6

/**
 * Rank the static catalog + fetched index against `query`. With an empty query
 * it returns the static quick-actions and navigation entries (the empty-state
 * launcher), capability-filtered for the viewer's role. The component groups the
 * flat list by category for display.
 */
export function runWorkspaceSearch(
  query: string,
  index: WorkspaceSearchIndex,
  workspaceId: string,
  role: WorkspaceRole,
): WsSearchResult[] {
  const q = query.trim()
  const results: WsSearchResult[] = []
  const push = (r: WsSearchResult) => results.push(r)

  // Static: quick actions (capability-gated)
  for (const a of WS_ACTION_CATALOG) {
    if (a.cap && !can(role, a.cap)) continue
    const score = q ? fuzzyMatchFields(q, [a.label, a.keywords, a.subtitle]) : 0
    if (score === null) continue
    push({
      id: a.id,
      category: 'action',
      title: a.label,
      subtitle: a.subtitle,
      icon: a.icon,
      action: { kind: 'navigate', href: withWorkspace(workspaceId, a.path) },
      score,
    })
  }

  // Static: navigation (capability-gated)
  for (const n of WS_NAV_CATALOG) {
    if (n.cap && !can(role, n.cap)) continue
    const score = q ? fuzzyMatchFields(q, [n.label, n.keywords]) : 0
    if (score === null) continue
    push({
      id: n.id,
      category: 'navigation',
      title: n.label,
      icon: n.icon,
      action: { kind: 'navigate', href: withWorkspace(workspaceId, n.path) },
      score,
    })
  }

  // Dynamic index entries only contribute once the user starts typing — the
  // empty state stays a clean launcher of actions + destinations.
  if (!q) return results

  for (const s of index.servers) {
    const score = fuzzyMatchFields(q, [s.name, s.tags.join(' ')])
    if (score === null) continue
    push({
      id: `server-${s.guildId}`,
      category: 'server',
      title: s.name,
      subtitle: s.memberCount != null ? `${s.memberCount.toLocaleString()} members` : (s.tags[0] ?? undefined),
      icon: 'Server',
      imageUrl: s.iconUrl ?? undefined,
      badge: s.botInstalled ? undefined : 'NO BOT',
      action: { kind: 'navigate', href: withWorkspace(workspaceId, '/servers') },
      score,
    })
  }

  for (const m of index.members) {
    const score = fuzzyMatchFields(q, [m.name, m.role])
    if (score === null) continue
    push({
      id: `member-${m.userId}`,
      category: 'member',
      title: m.name,
      subtitle: undefined,
      icon: 'UserRound',
      imageUrl: m.avatar ?? undefined,
      badge: ROLE_TAG[m.role],
      action: { kind: 'navigate', href: withWorkspace(workspaceId, '/team') },
      score,
    })
  }

  for (const n of index.notes) {
    const score = fuzzyMatchFields(q, [n.body, n.author])
    if (score === null) continue
    const title = n.body.length > 80 ? `${n.body.slice(0, 80)}…` : n.body
    push({
      id: `note-${n.id}`,
      category: 'note',
      title: title || 'Untitled note',
      subtitle: n.author ? `by ${n.author}` : undefined,
      icon: 'StickyNote',
      badge: n.pinned ? 'PINNED' : undefined,
      action: { kind: 'navigate', href: withWorkspace(workspaceId, '/notes') },
      score,
    })
  }

  for (const t of index.tasks) {
    const score = fuzzyMatchFields(q, [t.title, t.priority, t.status])
    if (score === null) continue
    push({
      id: `task-${t.id}`,
      category: 'task',
      title: t.title,
      subtitle: t.priority !== 'normal' ? `${t.priority} priority` : undefined,
      icon: 'ListChecks',
      badge: TASK_STATUS_TAG[t.status],
      action: { kind: 'navigate', href: withWorkspace(workspaceId, '/tasks') },
      score,
    })
  }

  for (const i of index.incidents) {
    const score = fuzzyMatchFields(q, [i.title, i.severity, i.status])
    if (score === null) continue
    push({
      id: `incident-${i.id}`,
      category: 'incident',
      title: i.title,
      subtitle: `${i.severity} severity`,
      icon: 'ShieldAlert',
      badge: INCIDENT_STATUS_TAG[i.status],
      action: { kind: 'navigate', href: withWorkspace(workspaceId, '/incidents') },
      score,
    })
  }

  return results
}

export type WsGroupedResults = {
  category: WsSearchCategory
  label: string
  icon: string
  accent: string
  items: WsSearchResult[]
  /** Total matches before the per-category cap, for the "+N more" hint. */
  total: number
}[]

/**
 * Group a flat result list into capped, ordered sections. Sections are ordered
 * by their strongest hit (most relevant category first); the static
 * action/navigation sections keep their leading slots for the empty state.
 */
export function groupWorkspaceResults(results: WsSearchResult[], hasQuery: boolean): WsGroupedResults {
  const byCat = new Map<WsSearchCategory, WsSearchResult[]>()
  for (const r of results) {
    const arr = byCat.get(r.category)
    if (arr) arr.push(r)
    else byCat.set(r.category, [r])
  }

  const groups: WsGroupedResults = []
  for (const [category, items] of byCat) {
    items.sort((a, b) => b.score - a.score)
    const meta = WS_CATEGORY_META[category]
    groups.push({
      category,
      label: meta.label,
      icon: meta.icon,
      accent: meta.accent,
      items: items.slice(0, WS_CATEGORY_LIMIT),
      total: items.length,
    })
  }

  groups.sort((a, b) => {
    if (!hasQuery) return WS_CATEGORY_META[a.category].order - WS_CATEGORY_META[b.category].order
    const aBest = a.items[0]?.score ?? -Infinity
    const bBest = b.items[0]?.score ?? -Infinity
    if (bBest !== aBest) return bBest - aBest
    return WS_CATEGORY_META[a.category].order - WS_CATEGORY_META[b.category].order
  })
  return groups
}
