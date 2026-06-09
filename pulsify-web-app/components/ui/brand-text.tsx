import { Fragment, isValidElement, cloneElement, type ReactNode, type ReactElement } from 'react'

const BRAND = 'Pulsify'

// Characters that already close a sentence — if a description ends on one of
// these we don't append our own period.
const SENTENCE_END = '.!?:…'

/** Colour every occurrence of "Pulsify" with the accent span. Recurses into
 *  arrays + element children so it works on string and JSX descriptions alike.
 *  Punctuation is handled separately (see `highlightBrand`) so the brand span
 *  itself never swallows a trailing period. */
function brandify(node: ReactNode): ReactNode {
  if (typeof node === 'string') {
    if (!node.includes(BRAND)) return node
    const segments = node.split(BRAND)
    const out: ReactNode[] = []
    segments.forEach((seg, i) => {
      if (i > 0) {
        out.push(
          <span key={`brand-${i}`} className="font-medium" style={{ color: 'var(--p-1)' }}>
            {BRAND}
          </span>,
        )
      }
      if (seg) out.push(<Fragment key={`seg-${i}`}>{seg}</Fragment>)
    })
    return out
  }
  if (Array.isArray(node)) {
    return node.map((child, i) => <Fragment key={i}>{brandify(child)}</Fragment>)
  }
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>
    if (el.props.children == null) return node
    return cloneElement(el, undefined, brandify(el.props.children))
  }
  return node
}

/** The last non-whitespace character of a node's rendered text, walking to the
 *  deepest/last text node. Used to decide whether a sentence period is missing. */
function lastTextChar(node: ReactNode): string {
  if (typeof node === 'string') return node.trimEnd().slice(-1)
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const c = lastTextChar(node[i])
      if (c) return c
    }
    return ''
  }
  if (isValidElement(node)) {
    return lastTextChar((node as ReactElement<{ children?: ReactNode }>).props.children)
  }
  return ''
}

/**
 * Brands "Pulsify" in `node` (accent-coloured span — `var(--p-1)`) and ensures
 * the sentence ends on a full stop. Used by page/view headers for the short
 * description under each title.
 *
 * The trailing period is added ONCE, at the top level, OUTSIDE any brand span —
 * so a description that ends on the word "Pulsify" reads "… Pulsify." with the
 * period in the normal text colour, not as part of the accent-coloured brand.
 * When "Pulsify" sits mid-sentence, the brand is still coloured but no extra
 * period is added (the author's own punctuation closes the sentence).
 */
export function highlightBrand(node: ReactNode): ReactNode {
  const branded = brandify(node)
  const last = lastTextChar(node)
  const needsPeriod = last !== '' && !SENTENCE_END.includes(last)
  if (!needsPeriod) return branded
  return (
    <>
      {branded}
      {'.'}
    </>
  )
}
