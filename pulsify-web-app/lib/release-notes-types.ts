/**
 * Release-notes types + presentation maps. Lives in its own file (no
 * `server-only` import, no `fs` usage) so client components can pull in the
 * label + colour constants without dragging the loader's server-only marker
 * into the client bundle.
 */

export type ReleaseCategory =
  | 'feature'
  | 'improvement'
  | 'fix'
  | 'uiux'
  | 'performance'
  | 'other'

export type ReleaseSection = {
  title: string
  /** Best-guess category for filtering / colour-coding. */
  category: ReleaseCategory
  items: { lead: string | null; body: string }[]
}

export type Release = {
  version: string
  /** Short SemVer-style key used to sort and to anchor the entry. */
  versionKey: string
  title: string
  /** Human-readable release date — the file's trailing date line, or mtime as fallback. */
  date: string
  /** Sortable timestamp for the file's mtime, ms since epoch. */
  mtime: number
  description: string
  sections: ReleaseSection[]
  outro: string | null
}

/**
 * A release flattened to the shape the `/changelog` embed renders — a single
 * description, a flat bullet list, and an optional outro. Client-safe so the
 * Presence "Publish changelog" UI can preview it without the server-only loader.
 */
export type ChangelogRelease = {
  version: string
  title: string
  date: string
  description: string
  highlights: string[]
  outro: string | null
}

/**
 * Flatten a release's structured sections into the flat bullet list the
 * `/changelog` embed shows. Mirrors pulse-bot/src/version.js parseRelease: each
 * bullet keeps its `**lead** — body` form so the embed renders the lead bold.
 */
export function flattenHighlights(sections: ReleaseSection[]): string[] {
  const out: string[] = []
  for (const section of sections) {
    for (const item of section.items) {
      out.push(item.lead ? `**${item.lead}** — ${item.body}` : item.body)
    }
  }
  return out
}

/** Reduce a parsed Release to the client-safe changelog shape. */
export function toChangelogRelease(r: {
  version: string
  title: string
  date: string
  description: string
  sections: ReleaseSection[]
  outro: string | null
}): ChangelogRelease {
  return {
    version: r.version,
    title: r.title,
    date: r.date,
    description: r.description,
    highlights: flattenHighlights(r.sections),
    outro: r.outro,
  }
}

export const RELEASE_CATEGORY_LABEL: Record<ReleaseCategory, string> = {
  feature: 'Features',
  improvement: 'Improvements',
  fix: 'Fixes',
  uiux: 'UI/UX',
  performance: 'Performance',
  other: 'Other',
}

/** Accent colour per category — drives the badge + section dot. */
export const RELEASE_CATEGORY_COLOR: Record<ReleaseCategory, string> = {
  feature: 'var(--p-1)',
  improvement: '#3b82f6',
  fix: '#f87171',
  uiux: '#a855f7',
  performance: '#10b981',
  other: 'var(--text-3)',
}
