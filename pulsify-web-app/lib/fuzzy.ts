// Lightweight fuzzy matcher behind the global search / command palette.
// Scores how well `query` matches `target` as a subsequence — rewarding
// consecutive runs, word-boundary hits and prefixes, the way fzf does, but
// tiny and dependency-free. Returns null when there's no match so callers can
// drop non-matching items cheaply while scanning large lists (1000+ members).

export type FuzzyMatch = {
  score: number
  /** Indices in `target` that matched — used to highlight the result. */
  positions: number[]
}

const SCORE_MATCH = 16
const BONUS_CONSECUTIVE = 12
const BONUS_WORD_START = 10
const BONUS_PREFIX = 8
const PENALTY_GAP = 2 // per skipped char between two matched chars
const PENALTY_LEADING = 1 // per char before the first match

/** True when `ch` begins a new "word" relative to the char before it. */
function isWordBoundary(prev: string | undefined, ch: string): boolean {
  if (prev === undefined) return true
  if (/[\s\-_./:#@]/.test(prev)) return true
  // camelCase / digit boundaries (e.g. the "S" in "guildSettings").
  return /[a-z0-9]/.test(prev) && /[A-Z]/.test(ch)
}

export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const q = query.trim()
  if (!q) return { score: 0, positions: [] }
  if (!target) return null

  const tl = target.toLowerCase()
  const ql = q.toLowerCase()

  // Fast path: a contiguous substring beats any gapped subsequence. Big bonus
  // for a prefix or word-start hit so "mod" ranks "Moderation" above "Random".
  const sub = tl.indexOf(ql)
  if (sub !== -1) {
    const positions: number[] = []
    for (let i = 0; i < ql.length; i++) positions.push(sub + i)
    let score = ql.length * (SCORE_MATCH + BONUS_CONSECUTIVE)
    if (sub === 0) score += BONUS_PREFIX * 4
    else if (isWordBoundary(target[sub - 1], target[sub])) score += BONUS_WORD_START * 2
    score -= sub * PENALTY_LEADING
    return { score, positions }
  }

  // Subsequence match — every query char must appear in order.
  const positions: number[] = []
  let ti = 0
  let prevMatch = -2
  let score = 0
  for (let qi = 0; qi < ql.length; qi++) {
    const c = ql[qi]
    let found = -1
    for (; ti < tl.length; ti++) {
      if (tl[ti] === c) {
        found = ti
        break
      }
    }
    if (found === -1) return null
    score += SCORE_MATCH
    if (found === prevMatch + 1) score += BONUS_CONSECUTIVE
    else score -= (found - prevMatch - 1) * PENALTY_GAP
    if (isWordBoundary(target[found - 1], target[found])) score += BONUS_WORD_START
    if (found === 0) score += BONUS_PREFIX
    positions.push(found)
    prevMatch = found
    ti = found + 1
  }
  // Nudge denser/shorter targets above sprawling ones with the same hits.
  score -= Math.max(0, target.length - ql.length) * 0.05
  return { score, positions }
}

/**
 * Match against several fields and return the best score, or null if none
 * match. Fields earlier in the list get a small priority boost, so a hit on a
 * name outranks a hit on a description for the same query.
 */
export function fuzzyMatchFields(
  query: string,
  fields: (string | null | undefined)[],
): number | null {
  if (!query.trim()) return 0
  let best: number | null = null
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    if (!f) continue
    const m = fuzzyMatch(query, f)
    if (m) {
      const adjusted = m.score - i * 4
      if (best === null || adjusted > best) best = adjusted
    }
  }
  return best
}
