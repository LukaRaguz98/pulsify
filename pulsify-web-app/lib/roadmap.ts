import 'server-only'
import { promises as fs } from 'fs'
import path from 'path'
import type { RoadmapItem, RoadmapStatus } from './roadmap-types'

// Re-export the client-safe types + maps from the loader entry point so
// server callers don't need to know about the split.
export type { RoadmapItem, RoadmapStatus } from './roadmap-types'
export {
  ROADMAP_STATUS_LABEL,
  ROADMAP_COLUMN_LABEL,
  ROADMAP_STATUS_COLOR,
} from './roadmap-types'

// Each roadmap status maps to one task file. The files live next to the
// release notes (resources/notes/Tasks (…).txt) and ship outside the web app,
// so the loader probes both layouts the release-notes loader does.
const TASK_FILES: Record<RoadmapStatus, string> = {
  shipped: 'Tasks (Shipped).txt',
  progress: 'Tasks (In Progress).txt',
  planned: 'Tasks (Planned).txt',
}

const NOTES_DIRS = [
  path.join(process.cwd(), '..', 'resources', 'notes'),
  path.join(process.cwd(), 'resources', 'notes'),
]

// `PULSIFY-12 Some Title (v0.12.0)` — version is optional, separator may be
// a hyphen or em-dash, the trailing version may use parens or square brackets.
const HEADER_RE = /^(PULSIFY-\d+)\s*[—-]?\s*(.+?)\s*[\(\[]\s*v?([\d.]+)\s*[\)\]]\s*$/
const HEADER_FALLBACK_RE = /^(PULSIFY-\d+)\s*[—-]?\s*(.+)$/

async function findNotesDir(): Promise<string | null> {
  for (const dir of NOTES_DIRS) {
    try {
      const stat = await fs.stat(dir)
      if (stat.isDirectory()) return dir
    } catch {
      // try next
    }
  }
  return null
}

// Lightweight heuristic so cards get a tag chip. Keyword search hits the
// title first, then the description as a fallback. The taxonomy mirrors the
// landing-page feature pillars so the visual language stays consistent.
function categoryFor(title: string, description: string): string {
  const t = `${title} ${description}`.toLowerCase()
  if (/(workspace|team|collab|multi.?server)/.test(t)) return 'Workspaces'
  if (/(moderation|automod|ban|kick|warn|timeout|guard)/.test(t)) return 'Moderation'
  if (/(analytic|stat|insight|chart|metric)/.test(t)) return 'Analytics'
  if (/(ticket|support)/.test(t)) return 'Tickets'
  if (/(giveaway|engagement|level|xp|reputation)/.test(t)) return 'Engagement'
  if (/(automation|workflow|scheduled|task)/.test(t)) return 'Automations'
  if (/(role|permission)/.test(t)) return 'Roles'
  if (/(channel|server.?structure)/.test(t)) return 'Channels'
  if (/(event)/.test(t)) return 'Events'
  if (/(notification|activity.?feed)/.test(t)) return 'Notifications'
  if (/(command|slash)/.test(t)) return 'Commands'
  if (/(pricing|billing|subscription|payment)/.test(t)) return 'Billing'
  if (/(release|changelog|roadmap)/.test(t)) return 'Platform'
  if (/(landing|pricing|public|page|website|legal|privacy|terms|faq|community|support)/.test(t)) return 'Website'
  if (/(onboarding|setup|wizard)/.test(t)) return 'Onboarding'
  if (/(member|profile|user)/.test(t)) return 'Members'
  if (/(search|palette)/.test(t)) return 'Search'
  if (/(ai|smart|recommend)/.test(t)) return 'AI'
  return 'Platform'
}

/**
 * Parse one task file. Entries are separated by the start of a new
 * `PULSIFY-N` line at column 0; the first non-empty line under the
 * `Description` header (or, failing that, the first non-empty line after the
 * task title) becomes the card body.
 */
function parseTaskFile(status: RoadmapStatus, content: string): RoadmapItem[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const items: RoadmapItem[] = []

  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    const trimmed = raw.trimStart()
    // Headers must start at col 0; indented "PULSIFY-…" mentions inside
    // a task body shouldn't open a new card.
    if (raw === trimmed && /^PULSIFY-\d/.test(trimmed)) {
      const headerMatch = trimmed.match(HEADER_RE)
      const fallbackMatch = headerMatch ? null : trimmed.match(HEADER_FALLBACK_RE)
      const id = headerMatch?.[1] ?? fallbackMatch?.[1] ?? null
      const title = (headerMatch?.[2] ?? fallbackMatch?.[2] ?? '').trim()
      const version = headerMatch?.[3] ?? null
      i++

      // Pull the description: prefer the first line under a "Description"
      // sub-header (1–2 levels of indent), otherwise the first non-empty
      // line we run into before the next PULSIFY-N header.
      let description = ''
      let seenDescription = false
      while (i < lines.length) {
        const peek = lines[i]
        const peekTrim = peek.trim()
        // Next entry starts → stop.
        if (peek === peek.trimStart() && /^PULSIFY-\d/.test(peekTrim)) break
        if (peekTrim === '') { i++; continue }
        if (/^description\b/i.test(peekTrim)) { seenDescription = true; i++; continue }
        if (seenDescription || description === '') {
          description = peekTrim
          if (seenDescription) { i++; break }
        }
        i++
      }

      items.push({
        status,
        id,
        title,
        version,
        description,
        category: categoryFor(title, description),
      })
      continue
    }
    i++
  }

  return items
}

export async function getRoadmap(): Promise<Record<RoadmapStatus, RoadmapItem[]>> {
  const empty: Record<RoadmapStatus, RoadmapItem[]> = { shipped: [], progress: [], planned: [] }
  const dir = await findNotesDir()
  if (!dir) return empty

  const result: Record<RoadmapStatus, RoadmapItem[]> = { shipped: [], progress: [], planned: [] }
  for (const status of Object.keys(TASK_FILES) as RoadmapStatus[]) {
    const full = path.join(dir, TASK_FILES[status])
    try {
      const content = await fs.readFile(full, 'utf8')
      result[status] = parseTaskFile(status, content)
    } catch {
      // missing file → empty list; the page handles empty states.
    }
  }

  // Shipped items list newest first (highest version → top of the card).
  result.shipped.sort((a, b) => {
    const va = (a.version ?? '0').split('.').map(Number)
    const vb = (b.version ?? '0').split('.').map(Number)
    for (let i = 0; i < 3; i++) if ((vb[i] || 0) !== (va[i] || 0)) return (vb[i] || 0) - (va[i] || 0)
    return 0
  })

  return result
}
