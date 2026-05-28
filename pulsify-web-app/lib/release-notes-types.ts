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
  /** Human-readable date from the file's mtime. */
  date: string
  /** Sortable timestamp for the file's mtime, ms since epoch. */
  mtime: number
  description: string
  sections: ReleaseSection[]
  outro: string | null
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
