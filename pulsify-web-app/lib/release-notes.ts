import 'server-only'
import { promises as fs } from 'fs'
import path from 'path'
import type { Release, ReleaseCategory, ReleaseSection } from './release-notes-types'

// Re-export the client-safe types + maps from the loader entry point so
// server callers don't need to know about the split.
export type { Release, ReleaseCategory, ReleaseSection } from './release-notes-types'
export { RELEASE_CATEGORY_LABEL, RELEASE_CATEGORY_COLOR } from './release-notes-types'

/**
 * Releases ship as flat `resources/notes/vX.Y.Z.txt` files. Each file uses a
 * lightweight markdown-ish shape we parse here so the public Release Notes
 * page (and the Community changelog teaser) can render structured data
 * without us maintaining a parallel JSON list:
 *
 *   **Pulsify vX.Y.Z — Title**       ← header line
 *   One-line description.            ← lead paragraph
 *
 *   **Section title**                ← bold section header
 *   - **Item title** — body          ← bullets, optional bold lead
 *   - Plain bullet                   ← supported too
 *
 *   **Another section**
 *   - …
 *
 *   Closing paragraph.               ← optional, becomes outro
 *
 * The header line is required; everything below it is best-effort. Files that
 * don't match the header pattern are skipped silently instead of crashing
 * the page.
 */

const NOTES_DIRS = [
  // Monorepo layout — the web app sits at <repo>/pulsify-web-app/ so the
  // notes folder is one level up. Falls back to a sibling path so the page
  // still works on environments that ship resources/ inside the app.
  path.join(process.cwd(), '..', 'resources', 'notes'),
  path.join(process.cwd(), 'resources', 'notes'),
]

const HEADER_RE = /^\*\*Pulsify\s+v([\d.]+)\s*[—-]\s*(.+?)\*\*$/
const SECTION_RE = /^\*\*(.+?)\*\*$/
const BULLET_RE = /^[-*•]\s+(.*)$/
const BULLET_LEAD_RE = /^\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/
// Optional trailing `Month DD, YYYY` line that records the actual release date.
const DATE_RE = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/

/** Format a date for display, matching the short style used across the UI. */
function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function categoryFor(sectionTitle: string): ReleaseCategory {
  const t = sectionTitle.toLowerCase()
  if (/(fix|bug|crash|broken|patch)/.test(t)) return 'fix'
  if (/(performance|speed|fast|optim)/.test(t)) return 'performance'
  if (/(ui|ux|design|visual|polish|refresh)/.test(t)) return 'uiux'
  if (/(improve|refine|quality|smaller|rounding|enhanc|update)/.test(t)) return 'improvement'
  return 'feature'
}

async function findNotesDir(): Promise<string | null> {
  for (const dir of NOTES_DIRS) {
    try {
      const stat = await fs.stat(dir)
      if (stat.isDirectory()) return dir
    } catch {
      // try next candidate
    }
  }
  return null
}

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const av = pa[i] ?? 0
    const bv = pb[i] ?? 0
    if (av !== bv) return av - bv
  }
  return 0
}

function parseRelease(content: string, mtime: Date): Omit<Release, 'mtime'> | null {
  // Split into lines but preserve blanks — section / outro boundaries need them.
  const rawLines = content.replace(/\r\n/g, '\n').split('\n')

  // Pull an explicit `Month DD, YYYY` line off the end if present. It records
  // the real release date (file mtime is unreliable — a clone/deploy resets it),
  // and stripping it here keeps it out of the outro / last-bullet during the
  // body walk below.
  let explicitDate: Date | null = null
  let end = rawLines.length
  while (end > 0 && rawLines[end - 1].trim() === '') end--
  if (end > 0 && DATE_RE.test(rawLines[end - 1].trim())) {
    const parsed = new Date(rawLines[end - 1].trim())
    if (!Number.isNaN(parsed.getTime())) explicitDate = parsed
    end--
  }
  const lines = rawLines.slice(0, end)

  // First non-blank line must be the header `**Pulsify vX.Y.Z — Title**`.
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  const header = lines[i]?.trim()
  const headerMatch = header?.match(HEADER_RE)
  if (!headerMatch) return null
  i++

  // Lead paragraph: the next non-blank line.
  let description = ''
  while (i < lines.length && lines[i].trim() === '') i++
  if (i < lines.length && !SECTION_RE.test(lines[i].trim()) && !BULLET_RE.test(lines[i].trim())) {
    description = lines[i].trim()
    i++
  }

  // Walk the body building sections and a final outro paragraph.
  const sections: ReleaseSection[] = []
  let currentSection: ReleaseSection | null = null
  let outroLines: string[] = []

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trim()
    i++

    if (!line) continue

    const sectionMatch = line.match(SECTION_RE)
    if (sectionMatch) {
      // New section: flush outro accumulator (it belonged to the previous
      // section, not the closing paragraph) and start fresh.
      outroLines = []
      currentSection = {
        title: sectionMatch[1].trim(),
        category: categoryFor(sectionMatch[1]),
        items: [],
      }
      sections.push(currentSection)
      continue
    }

    const bulletMatch = line.match(BULLET_RE)
    if (bulletMatch && currentSection) {
      const text = bulletMatch[1].trim()
      const leadMatch = text.match(BULLET_LEAD_RE)
      if (leadMatch) {
        currentSection.items.push({ lead: leadMatch[1].trim(), body: leadMatch[2].trim() })
      } else {
        // Keep inline `**bold**` markers — the renderer converts them to
        // <strong> at display time, so the raw text shouldn't be stripped.
        currentSection.items.push({ lead: null, body: text })
      }
      continue
    }

    // Anything else inside a section is a continuation of the last bullet,
    // otherwise it's outro material. We keep only the last paragraph as the
    // outro so multi-paragraph closers don't bloat the card.
    if (currentSection && currentSection.items.length > 0) {
      const last = currentSection.items[currentSection.items.length - 1]
      last.body = `${last.body} ${line}`.trim()
    } else {
      outroLines.push(line)
    }
  }

  return {
    version: headerMatch[1],
    versionKey: headerMatch[1],
    title: headerMatch[2].trim(),
    date: formatDate(explicitDate ?? mtime),
    description,
    sections,
    outro: outroLines.length > 0 ? outroLines.join(' ').trim() : null,
  }
}

/**
 * Load every release on disk, newest version first. Returns an empty array
 * when the notes directory can't be located — callers should render an empty
 * state in that case rather than 500'ing.
 */
export async function getReleases(): Promise<Release[]> {
  const dir = await findNotesDir()
  if (!dir) return []

  const entries = await fs.readdir(dir)
  const files = entries.filter((f) => /^v\d/.test(f) && f.endsWith('.txt'))

  const parsed: Release[] = []
  for (const f of files) {
    const full = path.join(dir, f)
    try {
      const [content, stat] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)])
      const result = parseRelease(content, stat.mtime)
      if (result) parsed.push({ ...result, mtime: stat.mtime.getTime() })
    } catch {
      // skip unreadable files instead of failing the whole page
    }
  }

  return parsed.sort((a, b) => compareVersion(b.versionKey, a.versionKey))
}
